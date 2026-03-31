(() => {
  const bootstrapEl = document.getElementById("bootstrap-data");
  const bootstrap = bootstrapEl ? JSON.parse(bootstrapEl.textContent || "{}") : {};
  const books = Array.isArray(bootstrap.library) ? bootstrap.library : [];
  const reading = bootstrap.reading || {};

  const searchEl = document.getElementById("storeSearch");
  const mainTabsEl = document.getElementById("storeMainTabs");
  const categoryTabsEl = document.getElementById("storeCategoryTabs");
  const rankColumnsEl = document.getElementById("rankColumns");
  const rankTitleEl = document.getElementById("storeRankTitle");
  const readShortcutEl = document.getElementById("readShortcut");
  if (!searchEl || !mainTabsEl || !categoryTabsEl || !rankColumnsEl) return;

  const tabFilters = {
    推荐: () => true,
    小说: () => true,
    听书: (book) => ["治愈", "情感", "成长", "现实"].includes(book.category),
  };

  const rankingTitleMap = {
    推荐: "推荐榜",
    小说: "小说榜",
    听书: "听书馆",
  };

  const speechSupport = Boolean(window.speechSynthesis && "SpeechSynthesisUtterance" in window);
  let speechUtterance = null;
  let speechActiveId = "";
  let speechActiveBtn = null;

  const state = {
    mainTab: "推荐",
    category: "全部",
    keyword: "",
  };

  function getCategories() {
    const source = books.filter(tabFilters[state.mainTab] || (() => true));
    return ["全部", ...new Set(source.map((item) => item.category).filter(Boolean))];
  }

  function getTabSource() {
    return books.filter(tabFilters[state.mainTab] || (() => true));
  }

  function filteredItems() {
    const source = getTabSource();
    const byCategory =
      state.category === "全部"
        ? source
        : source.filter((item) => item.category === state.category);
    if (!state.keyword) return byCategory;
    return byCategory.filter((item) => {
      const text = `${item.title} ${item.author} ${item.category} ${item.blurb}`.toLowerCase();
      return text.includes(state.keyword);
    });
  }

  function rankingBooks(items) {
    return items
      .map((book, index) => ({
        ...book,
        score:
          100000 +
          rankBase(state.mainTab) * 1000 +
          (hash(`${state.mainTab}|${book.id}|${book.author}`) % 800) +
          (books.length - index),
      }))
      .sort((a, b) => b.score - a.score)
      .slice(0, 16);
  }

  function rankBase(tab) {
    switch (tab) {
      case "小说":
        return 52;
      case "听书":
        return 46;
      default:
        return 55;
    }
  }

  function updateReadShortcut() {
    const readBookId = String(reading.lastBookId || books[0]?.id || "").trim();
    const readChapter = Math.max(1, Number(reading.lastChapter || 1));
    if (readShortcutEl && readBookId) {
      readShortcutEl.href = `/read/${encodeURIComponent(readBookId)}?chapter=${readChapter}`;
    }
  }

  function coverHtml(book) {
    const image = String(book.coverImage || "").trim();
    if (image) {
      return `<span class="rank-cover"><img src="${escapeHtml(image)}" alt="${escapeHtml(
        book.title || "小说封面"
      )}" loading="lazy" referrerpolicy="no-referrer" /></span>`;
    }
    const fallback = escapeHtml(
      String(book.cover || "linear-gradient(160deg,#364862 0%,#5e7ca5 100%)")
    );
    return `<span class="rank-cover" style="background:${fallback};"></span>`;
  }

  function renderMainTabs() {
    mainTabsEl.querySelectorAll(".main-tab").forEach((node) => {
      const tab = node.getAttribute("data-tab") || "";
      if (tab === state.mainTab) node.classList.add("active");
      else node.classList.remove("active");
    });
    if (rankTitleEl) {
      rankTitleEl.textContent = rankingTitleMap[state.mainTab] || "推荐榜";
    }
  }

  function renderCategories() {
    const categories = getCategories();
    if (!categories.includes(state.category)) {
      state.category = "全部";
    }
    categoryTabsEl.innerHTML = categories
      .map(
        (category) =>
          `<button class="sub-tab ${
            category === state.category ? "active" : ""
          }" type="button" data-category="${escapeHtml(category)}">${escapeHtml(category)}</button>`
      )
      .join("");
  }

  function renderTabContent() {
    const list = filteredItems();
    if (state.mainTab !== "听书") {
      cancelSpeech();
    }
    if (state.mainTab === "听书") {
      renderListenMode(list);
      return;
    }
    renderRankMode(list);
  }

  function renderRankMode(list) {
    rankColumnsEl.className = "rank-columns rank-mode";
    const sorted = rankingBooks(list);
    if (!sorted.length) {
      rankColumnsEl.innerHTML = '<p class="empty-hint">未找到匹配内容，换个关键词试试。</p>';
      return;
    }
    // 分两列显示所有小说
    const mid = Math.ceil(sorted.length / 2);
    const left = sorted.slice(0, mid);
    const right = sorted.slice(mid);
    const makeColumn = (columnList, offset) =>
      `<div class="rank-column">${columnList
        .map(
          (book, index) => `
            <a class="rank-item" href="/read/${encodeURIComponent(book.id)}?chapter=1">
              <span class="rank-no">${offset + index + 1}</span>
              ${coverHtml(book)}
              <div class="rank-meta">
                <h3 class="rank-title">${escapeHtml(book.title)}</h3>
                <p class="rank-tag">新书 · ${escapeHtml(book.category || "小说")}</p>
                <p class="rank-desc">${escapeHtml(shortText(book.blurb || "", 23))}</p>
              </div>
            </a>`
        )
        .join("")}</div>`;
    rankColumnsEl.innerHTML = `${makeColumn(left, 0)}${makeColumn(right, mid)}`;
  }

  function renderListenMode(list) {
    rankColumnsEl.className = "rank-columns audio-mode";
    if (!list.length) {
      rankColumnsEl.innerHTML = '<p class="empty-hint">当前分类暂无可播放听书内容。</p>';
      return;
    }
    rankColumnsEl.innerHTML = `
      <div class="audio-list">
        ${list
          .map((item, index) => {
            const estimate = Math.max(1, Math.round((countText(item.excerpt || item.blurb || "") || 80) / 42));
            return `
              <article class="audio-card">
                <div class="audio-index">${index + 1}</div>
                <div class="audio-main">
                  <h3>${escapeHtml(item.title)}</h3>
                  <p>${escapeHtml(item.author)} · ${escapeHtml(item.category || "小说")} · 试听约 ${estimate} 分钟</p>
                  <p class="audio-excerpt">${escapeHtml(shortText(item.excerpt || item.blurb || "暂无简介", 68))}</p>
                </div>
                <div class="audio-actions">
                  <button class="audio-btn" type="button" data-audio-play="${escapeHtml(item.id)}">播放</button>
                  <a class="audio-link" href="/read/${encodeURIComponent(item.id)}?chapter=1">阅读原文</a>
                </div>
              </article>
            `;
          })
          .join("")}
      </div>
    `;
  }



  function playAudioById(bookId, buttonEl) {
    const item = books.find((entry) => entry.id === bookId);
    if (!item) return;
    if (!speechSupport) {
      if (buttonEl) buttonEl.textContent = "设备不支持";
      return;
    }

    if (speechActiveId === bookId && window.speechSynthesis.speaking) {
      cancelSpeech();
      return;
    }

    cancelSpeech();
    const text = `${item.title}。${item.excerpt || ""}。${item.blurb || ""}`;
    const utterance = new SpeechSynthesisUtterance(text);
    utterance.lang = "zh-CN";
    utterance.rate = 0.95;
    utterance.pitch = 1.02;
    utterance.volume = 1;
    utterance.onend = () => {
      if (speechActiveBtn) speechActiveBtn.textContent = "播放";
      speechUtterance = null;
      speechActiveId = "";
      speechActiveBtn = null;
    };
    utterance.onerror = () => {
      if (speechActiveBtn) speechActiveBtn.textContent = "播放";
      speechUtterance = null;
      speechActiveId = "";
      speechActiveBtn = null;
    };

    speechUtterance = utterance;
    speechActiveId = bookId;
    speechActiveBtn = buttonEl;
    if (speechActiveBtn) speechActiveBtn.textContent = "停止";
    window.speechSynthesis.cancel();
    window.speechSynthesis.speak(utterance);
  }

  function cancelSpeech() {
    if (window.speechSynthesis) {
      window.speechSynthesis.cancel();
    }
    if (speechActiveBtn) {
      speechActiveBtn.textContent = "播放";
    }
    speechUtterance = null;
    speechActiveId = "";
    speechActiveBtn = null;
  }

  mainTabsEl.addEventListener("click", (event) => {
    const target = event.target;
    if (!(target instanceof Element)) return;
    const tabNode = target.closest("[data-tab]");
    if (!tabNode) return;
    const tab = String(tabNode.getAttribute("data-tab") || "").trim();
    if (!tab || tab === state.mainTab) return;
    state.mainTab = tab;
    state.category = "全部";
    renderAll();
  });

  categoryTabsEl.addEventListener("click", (event) => {
    const target = event.target;
    if (!(target instanceof Element)) return;
    const categoryNode = target.closest("[data-category]");
    if (!categoryNode) return;
    const category = String(categoryNode.getAttribute("data-category") || "").trim();
    if (!category || category === state.category) return;
    state.category = category;
    renderAll();
  });

  searchEl.addEventListener("input", () => {
    state.keyword = String(searchEl.value || "").trim().toLowerCase();
    renderTabContent();
  });

  rankColumnsEl.addEventListener("click", (event) => {
    const target = event.target;
    if (!(target instanceof Element)) return;
    const playBtn = target.closest("[data-audio-play]");
    if (!playBtn) return;
    const audioId = String(playBtn.getAttribute("data-audio-play") || "").trim();
    if (!audioId) return;
    playAudioById(audioId, playBtn);
  });

  window.addEventListener("beforeunload", () => {
    cancelSpeech();
  });

  renderAll();
  updateReadShortcut();

  function renderAll() {
    renderMainTabs();
    renderCategories();
    renderTabContent();
  }

  function shortText(text, maxLength) {
    const source = String(text || "").trim();
    if (!source) return "";
    if (source.length <= maxLength) return source;
    return `${source.slice(0, maxLength)}...`;
  }

  function countText(text) {
    return String(text || "").replace(/\s+/g, "").length;
  }

  function hash(text) {
    let h = 0;
    for (let i = 0; i < text.length; i += 1) {
      h = (h * 31 + text.charCodeAt(i)) >>> 0;
    }
    return h;
  }

  function escapeHtml(text) {
    return String(text)
      .replaceAll("&", "&amp;")
      .replaceAll("<", "&lt;")
      .replaceAll(">", "&gt;")
      .replaceAll('"', "&quot;")
      .replaceAll("'", "&#39;");
  }
})();
