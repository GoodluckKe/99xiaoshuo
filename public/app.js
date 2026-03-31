(() => {
  const MAX_DRAFT_ARCHIVE = 500;
  const bootstrapEl = document.getElementById("bootstrap-data");
  const bootstrap = bootstrapEl ? JSON.parse(bootstrapEl.textContent || "{}") : {};
  const profile = bootstrap.profile || {};

  const fallbackBooks = [
    {
      id: "b01",
      title: "雾海回声",
      author: "森川",
      category: "悬疑",
      mood: "高压推理",
      blurb: "一次失踪案把主角推入旧城区的秘密网络，每一章都在反转。",
      excerpt:
        "凌晨一点，旧码头的雾像翻涌的玻璃。我在铁门上找到第三个手印，和前两次一样，方向都朝向海。",
      cover: "linear-gradient(160deg,#313866 0%,#504099 45%,#7c6bd0 100%)",
    },
    {
      id: "b02",
      title: "星渊日记",
      author: "寂河",
      category: "科幻",
      mood: "想象开阔",
      blurb: "人类意识可以上传后，记忆成为新的财富与武器。",
      excerpt:
        "我第一次看见自己的意识备份在屏幕里眨眼。它说，别相信你记得的一切，那些只是被允许记得的版本。",
      cover: "linear-gradient(160deg,#15395b 0%,#1878b8 55%,#59a8e7 100%)",
    },
    {
      id: "b03",
      title: "枫桥慢邮",
      author: "渡柳",
      category: "治愈",
      mood: "温暖细腻",
      blurb: "一间只在雨天营业的邮局，把遗憾写成新的开始。",
      excerpt:
        "她把那张皱巴巴的明信片递给我，说只要盖上邮戳，过去就不会再追上来。",
      cover: "linear-gradient(160deg,#a06d3f 0%,#d19b5d 60%,#f1d0a0 100%)",
    },
    {
      id: "b04",
      title: "南城昼夜",
      author: "许念",
      category: "现实",
      mood: "都市成长",
      blurb: "在快节奏城市里，四个年轻人把理想缝进生活缝隙。",
      excerpt:
        "电梯门关上的那刻，我突然明白，成年人的告别常常没有拥抱，只有下一次的会议邀请。",
      cover: "linear-gradient(160deg,#425a46 0%,#5f8b65 55%,#9bb59d 100%)",
    },
    {
      id: "b05",
      title: "潮汐与王座",
      author: "惊砚",
      category: "奇幻",
      mood: "史诗宏大",
      blurb: "五座岛屿争夺海神遗物，平民少女卷入王权风暴。",
      excerpt:
        "潮声在王宫穹顶回响，长桌尽头的王冠没有主人，只有被盐雾腐蚀的誓言。",
      cover: "linear-gradient(160deg,#5e2d2d 0%,#9a4242 55%,#cf7d66 100%)",
    },
    {
      id: "b06",
      title: "冬枝情书",
      author: "芷寒",
      category: "情感",
      mood: "情绪共鸣",
      blurb: "两位旧友在断联七年后重逢，在误解中重建亲密关系。",
      excerpt:
        "她说你总把心事写成旁白。我笑了笑，原来你一直都看得懂，只是我们都不敢承认。",
      cover: "linear-gradient(160deg,#7a314a 0%,#b24f77 60%,#e49ac1 100%)",
    },
    {
      id: "b07",
      title: "山海临摹",
      author: "澄砚",
      category: "历史",
      mood: "厚重沉浸",
      blurb: "一位画师穿行三朝，以壁画记录被史书遗漏的普通人。",
      excerpt:
        "史官写的是将军，我画的是搬石头的少年。他们都在同一场战役里，只是名字不同。",
      cover: "linear-gradient(160deg,#5a4a32 0%,#8d724e 55%,#c9a773 100%)",
    },
    {
      id: "b08",
      title: "向光生长",
      author: "栖云",
      category: "成长",
      mood: "自我突破",
      blurb: "社恐女孩通过连载短篇，逐步建立表达自我的勇气。",
      excerpt:
        "我第一次按下发布键时，手指抖得像雨里的树叶。可刷新页面后，看见了第一个'继续写'。",
      cover: "linear-gradient(160deg,#2f4f65 0%,#5483a3 55%,#89b4cf 100%)",
    },
  ];

  const books =
    Array.isArray(bootstrap.library) && bootstrap.library.length
      ? bootstrap.library.map((remoteBook, index) => {
          const fallback = fallbackBooks[index % fallbackBooks.length] || fallbackBooks[0] || {};
          return { ...fallback, ...remoteBook };
        })
      : fallbackBooks;

  const categoryChipsEl = document.getElementById("categoryChips");
  const bookGridEl = document.getElementById("bookGrid");
  const bookTitleEl = document.getElementById("bookTitle");
  const bookMetaEl = document.getElementById("bookMeta");
  const bookExcerptEl = document.getElementById("bookExcerpt");
  const startReadBtn = document.getElementById("startReadBtn");
  const saveDraftBtn = document.getElementById("saveDraftBtn");
  const createNovelBtn = document.getElementById("createNovelBtn");
  const uploadNovelBtn = document.getElementById("uploadNovelBtn");
  const analyzeBtn = document.getElementById("analyzeBtn");
  const novelTitleInput = document.getElementById("novelTitleInput");
  const novelCategorySelect = document.getElementById("novelCategorySelect");
  const novelSelect = document.getElementById("novelSelect");
  const chapterSelect = document.getElementById("chapterSelect");
  const createChapterBtn = document.getElementById("createChapterBtn");
  const draftTitleInput = document.getElementById("draftTitleInput");
  const draftEditor = document.getElementById("draftEditor");
  const wordCountEl = document.getElementById("wordCount");
  const analysisHintEl = document.getElementById("analysisHint");
  const savedNovelsMiniEl = document.getElementById("savedNovelsMini");
  const savedChaptersMiniEl = document.getElementById("savedChaptersMini");
  const draftListEl = document.getElementById("draftList");
  const searchInput = document.getElementById("searchInput");
  const habitTagsEl = document.getElementById("habitTags");
  const welcomeTitleEl = document.getElementById("welcomeTitle");
  const heroSubtitleEl = document.getElementById("heroSubtitle");
  const todayDateEl = document.getElementById("todayDate");
  const fortuneBadgeEl = document.getElementById("fortuneBadge");
  const personaTypeEl = document.getElementById("personaType");
  const personaSummaryEl = document.getElementById("personaSummary");
  const personaDetailCardsEl = document.getElementById("personaDetailCards");
  const traitRowsEl = document.getElementById("traitRows");
  const fortuneTextEl = document.getElementById("fortuneText");
  const fortuneAdviceEl = document.getElementById("fortuneAdvice");

  const creatorCategories = ["悬疑", "科幻", "治愈", "现实", "奇幻", "情感", "历史", "成长"];
  const readingBootstrap = bootstrap.reading || {};

  const storageKey = `novel-lab-state-${profile.userId || "guest"}`;
  const persistedState = loadState();
  const syncState = {
    hydrated: false,
    inFlight: false,
    timer: null,
    queuedSnapshot: null,
  };
  const state = {
    selectedCategory: persistedState.selectedCategory || "全部",
    selectedBookId:
      persistedState.selectedBookId || readingBootstrap.lastBookId || (books[0] ? books[0].id : ""),
    searchKeyword: "",
    readMinutes: mergeReadMinutes(
      persistedState.readMinutes || {},
      readingBootstrap.readMinutesByBook || {}
    ),
    draftTitle: persistedState.draftTitle || "",
    draftContent: persistedState.draftContent || "",
    drafts: persistedState.drafts || [],
    novels: normalizeNovels(persistedState.novels || []),
    activeNovelId: persistedState.activeNovelId || "",
    activeChapterNumber: Number(persistedState.activeChapterNumber || 1),
    updatedAt: persistedState.updatedAt || "",
  };

  init().catch(() => {
    syncState.hydrated = true;
    ensureCreatorSelection();
    bindEvents();
    hydrateProfile();
    renderCreatorState();
    renderAll();
  });

  async function init() {
    await hydrateStateFromServer();
    syncState.hydrated = true;
    ensureCreatorSelection();
    bindEvents();
    hydrateProfile();
    renderCreatorState();
    renderAll();
  }

  function bindEvents() {
    startReadBtn.addEventListener("click", () => {
      const currentBook = getCurrentBook();
      if (!currentBook) return;
      if (currentBook.isUserUploaded && currentBook.localNovelId) {
        openUploadedNovelInCreator(currentBook.localNovelId);
        return;
      }
      state.readMinutes[currentBook.id] = (state.readMinutes[currentBook.id] || 0) + 10;
      persistState();
      const chapter =
        readingBootstrap.lastBookId === currentBook.id && readingBootstrap.lastChapter
          ? Number(readingBootstrap.lastChapter)
          : 1;
      window.location.href = `/read/${encodeURIComponent(currentBook.id)}?chapter=${chapter}`;
    });

    saveDraftBtn.addEventListener("click", () => {
      saveCurrentChapter();
    });

    createNovelBtn.addEventListener("click", () => {
      createNovelFromCreator();
    });

    uploadNovelBtn.addEventListener("click", () => {
      uploadActiveNovelToStore();
    });

    novelSelect.addEventListener("change", () => {
      state.activeNovelId = novelSelect.value || "";
      const selectedNovel = getActiveNovel();
      state.activeChapterNumber = selectedNovel
        ? getNovelLatestChapterNumber(selectedNovel)
        : 1;
      renderCreatorState();
      persistState();
    });

    chapterSelect.addEventListener("change", () => {
      const nextNumber = normalizeChapterNumber(chapterSelect.value);
      state.activeChapterNumber = nextNumber;
      renderCreatorState();
      persistState();
    });

    createChapterBtn.addEventListener("click", () => {
      createNextChapter();
    });

    if (savedNovelsMiniEl) {
      savedNovelsMiniEl.addEventListener("click", (event) => {
        const target = event.target;
        if (!(target instanceof Element)) return;
        const deleteBtn = target.closest("[data-mini-novel-delete]");
        if (deleteBtn) {
          const novelId = String(deleteBtn.getAttribute("data-mini-novel-delete") || "");
          if (!novelId) return;
          deleteNovelById(novelId);
          return;
        }
        const button = target.closest("[data-mini-novel]");
        if (!button) return;
        const novelId = String(button.getAttribute("data-mini-novel") || "");
        if (!novelId) return;
        state.activeNovelId = novelId;
        const selectedNovel = getActiveNovel();
        state.activeChapterNumber = selectedNovel
          ? getNovelLatestChapterNumber(selectedNovel)
          : 1;
        renderCreatorState();
        persistState();
      });
    }

    if (savedChaptersMiniEl) {
      savedChaptersMiniEl.addEventListener("click", (event) => {
        const target = event.target;
        if (!(target instanceof Element)) return;
        const deleteBtn = target.closest("[data-mini-chapter-delete]");
        if (deleteBtn) {
          const chapterNumber = normalizeChapterNumber(
            deleteBtn.getAttribute("data-mini-chapter-delete")
          );
          deleteChapterByNumber(chapterNumber);
          return;
        }
        const button = target.closest("[data-mini-chapter]");
        if (!button) return;
        const chapterNumber = normalizeChapterNumber(button.getAttribute("data-mini-chapter"));
        state.activeChapterNumber = chapterNumber;
        renderCreatorState();
        persistState();
      });
    }

    draftListEl.addEventListener("click", (event) => {
      const target = event.target;
      if (!(target instanceof Element)) return;
      const deleteBtn = target.closest("[data-draft-delete]");
      if (!deleteBtn) return;
      const draftId = String(deleteBtn.getAttribute("data-draft-delete") || "");
      if (!draftId) return;
      const nextDrafts = state.drafts.filter((item) => item.id !== draftId);
      if (nextDrafts.length === state.drafts.length) return;
      state.drafts = nextDrafts;
      persistState();
      renderDrafts();
      renderInsights();
      analysisHintEl.textContent = "已删除这条存档。";
    });

    analyzeBtn.addEventListener("click", () => {
      renderInsights();
      analysisHintEl.textContent = "已根据你的阅读与写作行为刷新人格分析。";
    });

    draftTitleInput.addEventListener("input", () => {
      state.draftTitle = draftTitleInput.value || "";
      persistState();
    });

    draftEditor.addEventListener("input", () => {
      state.draftContent = draftEditor.value || "";
      persistState();
      renderWordCount();
      renderInsights();
    });

    searchInput.addEventListener("input", () => {
      state.searchKeyword = (searchInput.value || "").trim().toLowerCase();
      renderBookGrid();
    });

  }

  function hydrateProfile() {
    const name = String(bootstrap.profile?.name || bootstrap.profile?.userId || "").trim();
    const defaultBio =
      "背景与身份\n这位用户是一位AI原生开发工程师，同时也是一位运动爱好者，尤其喜欢乒乓球。\n他积极探索技术领域，并注重保持健康与持续创作。";
    const bio = normalizeHeroBio(bootstrap.profile?.bio || defaultBio);
    if (name) {
      welcomeTitleEl.style.display = "";
      welcomeTitleEl.textContent = name;
    } else {
      welcomeTitleEl.style.display = "none";
      welcomeTitleEl.textContent = "";
    }
    heroSubtitleEl.textContent = bio;
    heroSubtitleEl.setAttribute("title", bio);
    todayDateEl.textContent = formatDate(new Date());
  }

  function renderAll() {
    renderCreatorState();
    renderCategories();
    renderBookGrid();
    renderCurrentBook();
    renderWordCount();
    renderDrafts();
    renderInsights();
  }

  function renderCategories() {
    const categories = getStoreCategories();
    if (!categories.includes(state.selectedCategory)) {
      state.selectedCategory = "全部";
    }
    categoryChipsEl.innerHTML = "";
    categories.forEach((category) => {
      const btn = document.createElement("button");
      btn.type = "button";
      btn.className = `category-chip ${
        category === state.selectedCategory ? "active" : ""
      }`;
      btn.textContent = category;
      btn.addEventListener("click", () => {
        state.selectedCategory = category;
        persistState();
        renderCategories();
        renderBookGrid();
      });
      categoryChipsEl.appendChild(btn);
    });
  }

  function filteredBooks() {
    const byCategory = getStoreBooks().filter((book) => {
      if (state.selectedCategory === "全部") return true;
      return book.category === state.selectedCategory;
    });
    if (!state.searchKeyword) return byCategory;
    return byCategory.filter((book) => {
      const text = `${book.title} ${book.author} ${book.category} ${book.blurb}`.toLowerCase();
      return text.includes(state.searchKeyword);
    });
  }

  function renderBookGrid() {
    const list = filteredBooks();
    if (!list.length) {
      bookGridEl.innerHTML = `<div class="empty">没有匹配的书，试试换个关键词。</div>`;
      return;
    }

    if (!list.some((book) => book.id === state.selectedBookId)) {
      state.selectedBookId = list[0].id;
      persistState();
      renderCurrentBook();
    }

    bookGridEl.innerHTML = "";
    list.forEach((book) => {
      const card = document.createElement("article");
      card.className = `book-card ${book.id === state.selectedBookId ? "active" : ""}`;
      card.innerHTML = `
        ${renderBookCover(book)}
        <div class="book-content">
          <h4 class="book-name">${book.title}</h4>
          <p class="book-author">${book.author}</p>
          <span class="book-tag">${book.category} · ${book.mood}</span>
          <p class="book-note">${book.blurb}</p>
        </div>
      `;
      card.addEventListener("click", () => {
        state.selectedBookId = book.id;
        persistState();
        if (book.isUserUploaded && book.localNovelId) {
          openUploadedNovelInCreator(book.localNovelId);
          return;
        }
        const chapter =
          readingBootstrap.lastBookId === book.id && readingBootstrap.lastChapter
            ? Number(readingBootstrap.lastChapter)
            : 1;
        window.location.href = `/read/${encodeURIComponent(book.id)}?chapter=${chapter}`;
      });
      bookGridEl.appendChild(card);
    });
  }

  function renderBookCover(book) {
    const title = escapeHtml(book.title || "书籍");
    const image = (book.coverImage || "").trim();
    if (image) {
      return `<img class="book-cover-image" src="${escapeHtml(image)}" alt="${title} 封面" loading="lazy" referrerpolicy="no-referrer" />`;
    }
    const fallback = escapeHtml(book.cover || "linear-gradient(160deg,#3d4d63 0%,#657ea1 55%,#9fbbd5 100%)");
    return `<div class="book-cover" style="background:${fallback};"></div>`;
  }

  function getCurrentBook() {
    const storeBooks = getStoreBooks();
    return storeBooks.find((item) => item.id === state.selectedBookId) || storeBooks[0] || null;
  }

  function renderCurrentBook() {
    const current = getCurrentBook();
    if (!current) {
      bookTitleEl.textContent = "暂无书籍";
      bookMetaEl.textContent = "请先上传或创建书籍";
      bookExcerptEl.textContent = "当前书城没有可阅读内容。";
      habitTagsEl.innerHTML = "";
      return;
    }
    const minutes = state.readMinutes[current.id] || 0;
    const isRecent = readingBootstrap.lastBookId === current.id;
    const chapterTag = isRecent && readingBootstrap.lastChapter
      ? ` · 最近阅读 第${readingBootstrap.lastChapter}章`
      : "";
    bookTitleEl.textContent = current.title;
    bookMetaEl.textContent = `${current.author} · ${current.category} · 已阅读 ${minutes} 分钟${chapterTag}`;
    if (isRecent && readingBootstrap.lastExcerpt) {
      bookExcerptEl.textContent = readingBootstrap.lastExcerpt;
    } else {
      bookExcerptEl.textContent = current.excerpt || current.blurb || "点击进入正文开始阅读。";
    }
    const tags = [
      `阅读氛围：${current.mood}`,
      `分类偏好：${current.category}`,
      isRecent && readingBootstrap.lastChapterTitle
        ? `最近章节：${readingBootstrap.lastChapterTitle}`
        : minutes
          ? `连续沉浸：${minutes} 分钟`
          : "建议先阅读 10 分钟开始画像",
    ];
    habitTagsEl.innerHTML = tags.map((item) => `<span>${item}</span>`).join("");
  }

  function renderWordCount() {
    const chars = countCharacters(draftEditor.value || "");
    wordCountEl.textContent = `${chars} 字`;
  }

  function renderDrafts() {
    if (!state.drafts.length) {
      draftListEl.innerHTML = `<div class="empty">还没有草稿，写下第一段故事吧。</div>`;
      return;
    }
    draftListEl.innerHTML = state.drafts
      .map((draft) => {
        const date = formatShortDate(new Date(draft.createdAt));
        return `
          <div class="draft-item">
            <div class="draft-main">
              <strong>${escapeHtml(draft.title)}</strong>
              <span>${date} · ${draft.words} 字</span>
            </div>
            <button class="draft-delete" type="button" data-draft-delete="${escapeHtml(draft.id)}">删除</button>
          </div>
        `;
      })
      .join("");
  }

  function ensureCreatorSelection() {
    state.novels = normalizeNovels(state.novels);
    state.activeChapterNumber = normalizeChapterNumber(state.activeChapterNumber);
    if (!state.novels.length) {
      state.activeNovelId = "";
      return;
    }
    if (!state.novels.some((novel) => novel.id === state.activeNovelId)) {
      state.activeNovelId = state.novels[0].id;
    }
  }

  function getActiveNovel() {
    return state.novels.find((novel) => novel.id === state.activeNovelId) || null;
  }

  function getNovelChapterCount(novel) {
    return Array.isArray(novel?.chapters) ? novel.chapters.length : 0;
  }

  function getNovelLatestChapterNumber(novel) {
    if (!novel || !Array.isArray(novel.chapters) || !novel.chapters.length) return 1;
    return novel.chapters.reduce((max, item) => Math.max(max, Number(item.number || 1)), 1);
  }

  function findChapterByNumber(novel, chapterNumber) {
    if (!novel || !Array.isArray(novel.chapters)) return null;
    return novel.chapters.find((item) => Number(item.number) === Number(chapterNumber)) || null;
  }

  function normalizeChapterNumber(value) {
    const parsed = Number.parseInt(String(value || "1"), 10);
    if (!Number.isFinite(parsed)) return 1;
    return Math.max(1, parsed);
  }

  function renderCreatorState() {
    ensureCreatorSelection();
    const categories = creatorCategories;
    const novel = getActiveNovel();
    const selectedCategory = novel?.category || novelCategorySelect.value || categories[0];
    novelCategorySelect.innerHTML = categories
      .map((item) => `<option value="${escapeHtml(item)}">${escapeHtml(item)}</option>`)
      .join("");
    novelCategorySelect.value = selectedCategory;

    if (!state.novels.length) {
      novelSelect.innerHTML = '<option value="">暂无小说，请先创建</option>';
      novelSelect.value = "";
      chapterSelect.innerHTML = '<option value="">暂无章节</option>';
      chapterSelect.value = "";
      draftTitleInput.value = state.draftTitle || "";
      draftEditor.value = state.draftContent || "";
      saveDraftBtn.setAttribute("disabled", "true");
      createChapterBtn.setAttribute("disabled", "true");
      uploadNovelBtn.setAttribute("disabled", "true");
      uploadNovelBtn.textContent = "上传到书城（需 >20 章）";
      renderSavedMini();
      renderWordCount();
      return;
    }

    saveDraftBtn.removeAttribute("disabled");
    createChapterBtn.removeAttribute("disabled");
    novelSelect.innerHTML = state.novels
      .map((item) => {
        const chapterCount = getNovelChapterCount(item);
        const uploadTag = item.uploaded ? " · 已上架" : "";
        return `<option value="${escapeHtml(item.id)}">${escapeHtml(item.title)}（${chapterCount}章${uploadTag}）</option>`;
      })
      .join("");
    novelSelect.value = state.activeNovelId;

    const chapterNumbers = new Set(
      (novel?.chapters || []).map((item) => normalizeChapterNumber(item.number))
    );
    chapterNumbers.add(normalizeChapterNumber(state.activeChapterNumber));
    const chapterList = Array.from(chapterNumbers).sort((a, b) => a - b);
    chapterSelect.innerHTML = chapterList
      .map((number) => {
        const saved = findChapterByNumber(novel, number);
        const status = saved ? "" : "（未保存）";
        return `<option value="${number}">第${number}章${status}</option>`;
      })
      .join("");
    chapterSelect.value = String(state.activeChapterNumber);

    const chapter = findChapterByNumber(novel, state.activeChapterNumber);
    if (chapter) {
      state.draftTitle = chapter.title || `第${state.activeChapterNumber}章`;
      state.draftContent = chapter.content || "";
    } else {
      state.draftTitle = `第${state.activeChapterNumber}章`;
      state.draftContent = "";
    }
    draftTitleInput.value = state.draftTitle;
    draftEditor.value = state.draftContent;

    const chapterCount = getNovelChapterCount(novel);
    const canUpload = chapterCount > 20;
    uploadNovelBtn.textContent = novel.uploaded
      ? `已上传到书城（${chapterCount}章）`
      : `上传到书城（当前 ${chapterCount} 章，需 >20 章）`;
    if (canUpload) uploadNovelBtn.removeAttribute("disabled");
    else uploadNovelBtn.setAttribute("disabled", "true");

    renderSavedMini();
    renderWordCount();
  }

  function renderSavedMini() {
    if (!savedNovelsMiniEl || !savedChaptersMiniEl) return;
    const sortedNovels = [...state.novels].sort(
      (a, b) => new Date(b.updatedAt || 0).getTime() - new Date(a.updatedAt || 0).getTime()
    );
    if (!sortedNovels.length) {
      savedNovelsMiniEl.innerHTML = '<div class="empty compact">暂无已保存小说</div>';
      savedChaptersMiniEl.innerHTML = '<div class="empty compact">暂无已保存章节</div>';
      return;
    }

    savedNovelsMiniEl.innerHTML = sortedNovels
      .map((novel) => {
        const chapterCount = getNovelChapterCount(novel);
        const active = novel.id === state.activeNovelId ? " active" : "";
        const title = shortText(novel.title, 10);
        return `
          <div class="saved-mini-item">
            <button class="saved-mini-chip${active}" type="button" data-mini-novel="${escapeHtml(novel.id)}">《${escapeHtml(title)}》 · ${chapterCount}章</button>
            <button class="saved-mini-delete" type="button" data-mini-novel-delete="${escapeHtml(novel.id)}" aria-label="删除小说《${escapeHtml(novel.title || "未命名小说")}》">删</button>
          </div>
        `;
      })
      .join("");

    const activeNovel = getActiveNovel();
    const chapters = Array.isArray(activeNovel?.chapters)
      ? [...activeNovel.chapters].sort((a, b) => Number(b.number) - Number(a.number))
      : [];
    if (!chapters.length) {
      savedChaptersMiniEl.innerHTML = '<div class="empty compact">当前小说还没有已保存章节</div>';
      return;
    }
    savedChaptersMiniEl.innerHTML = chapters
      .map((chapter) => {
        const number = normalizeChapterNumber(chapter.number);
        const active = number === normalizeChapterNumber(state.activeChapterNumber) ? " active" : "";
        const title = shortText(chapter.title || `第${number}章`, 12);
        const chapterTitle = chapter.title || `第${number}章`;
        return `
          <div class="saved-mini-item">
            <button class="saved-mini-chip${active}" type="button" data-mini-chapter="${number}">第${number}章 · ${escapeHtml(title)}</button>
            <button class="saved-mini-delete" type="button" data-mini-chapter-delete="${number}" aria-label="删除章节 ${escapeHtml(chapterTitle)}">删</button>
          </div>
        `;
      })
      .join("");
  }

  function deleteNovelById(novelId) {
    const index = state.novels.findIndex((item) => item.id === novelId);
    if (index < 0) return;
    const removed = state.novels[index];
    state.novels.splice(index, 1);
    state.drafts = state.drafts.filter((item) => item.novelId !== novelId);

    if (state.activeNovelId === novelId) {
      state.activeNovelId = state.novels[0]?.id || "";
      const nextNovel = getActiveNovel();
      state.activeChapterNumber = nextNovel ? getNovelLatestChapterNumber(nextNovel) : 1;
    }

    if (state.selectedBookId === `u-${novelId}`) {
      const storeBooks = getStoreBooks();
      state.selectedBookId = storeBooks[0]?.id || "";
    }

    if (!state.novels.length) {
      state.activeNovelId = "";
      state.activeChapterNumber = 1;
      state.draftTitle = "";
      state.draftContent = "";
    }

    persistState();
    renderAll();
    analysisHintEl.textContent = `已删除小说《${removed?.title || "未命名小说"}》。`;
  }

  function deleteChapterByNumber(chapterNumber) {
    const novel = getActiveNovel();
    if (!novel) return;
    const normalized = normalizeChapterNumber(chapterNumber);
    const index = novel.chapters.findIndex(
      (item) => normalizeChapterNumber(item.number) === normalized
    );
    if (index < 0) return;

    const removed = novel.chapters[index];
    novel.chapters.splice(index, 1);
    novel.updatedAt = new Date().toISOString();
    state.drafts = state.drafts.filter(
      (item) =>
        !(
          item.novelId === novel.id &&
          normalizeChapterNumber(item.chapterNumber) === normalized
        )
    );

    if (!novel.chapters.length) {
      state.activeChapterNumber = 1;
      state.draftTitle = "第1章";
      state.draftContent = "";
    } else {
      const sortedNumbers = novel.chapters
        .map((item) => normalizeChapterNumber(item.number))
        .sort((a, b) => a - b);
      const nextLarger = sortedNumbers.find((item) => item > normalized);
      const nextChapter =
        nextLarger || sortedNumbers[sortedNumbers.length - 1] || 1;
      state.activeChapterNumber = nextChapter;
    }

    persistState();
    renderAll();
    analysisHintEl.textContent = `已删除第${normalized}章${removed?.title ? `《${removed.title}》` : ""}。`;
  }

  function createNextChapter() {
    const novel = getActiveNovel();
    if (!novel) {
      analysisHintEl.textContent = "请先创建一本小说。";
      return;
    }
    const nextNumber =
      Math.max(getNovelLatestChapterNumber(novel), normalizeChapterNumber(state.activeChapterNumber)) + 1;
    state.activeChapterNumber = nextNumber;
    state.draftTitle = `第${nextNumber}章`;
    state.draftContent = "";
    persistState();
    renderCreatorState();
    analysisHintEl.textContent = `已创建《${novel.title}》第${nextNumber}章，开始写作吧。`;
  }

  function createNovelFromCreator() {
    const title = (novelTitleInput.value || "").trim();
    const category = (novelCategorySelect.value || "").trim() || creatorCategories[0];
    if (!title) {
      analysisHintEl.textContent = "请先输入小说名称再创建。";
      return;
    }
    const now = new Date().toISOString();
    const novel = {
      id: `n_${Date.now()}_${Math.random().toString(16).slice(2, 8)}`,
      title,
      category,
      createdAt: now,
      updatedAt: now,
      uploaded: false,
      chapters: [],
    };
    state.novels.unshift(novel);
    state.activeNovelId = novel.id;
    state.activeChapterNumber = 1;
    state.draftTitle = "第1章";
    state.draftContent = "";
    novelTitleInput.value = "";
    persistState();
    renderAll();
    analysisHintEl.textContent = `已创建小说《${title}》，开始写第1章吧。`;
  }

  function saveCurrentChapter() {
    const novel = getActiveNovel();
    if (!novel) {
      analysisHintEl.textContent = "请先创建一本小说。";
      return;
    }
    const chapterNumber = normalizeChapterNumber(state.activeChapterNumber);
    const chapterTitle = (draftTitleInput.value || "").trim() || `第${chapterNumber}章`;
    const content = (draftEditor.value || "").trim();
    if (!content) {
      analysisHintEl.textContent = "章节内容为空，请先写一点再保存。";
      return;
    }

    const now = new Date().toISOString();
    const words = countCharacters(content);
    const existingIndex = novel.chapters.findIndex(
      (item) => Number(item.number) === Number(chapterNumber)
    );
    const chapterData = {
      id:
        existingIndex >= 0
          ? novel.chapters[existingIndex].id
          : `c_${Date.now()}_${Math.random().toString(16).slice(2, 8)}`,
      number: chapterNumber,
      title: chapterTitle,
      content,
      words,
      updatedAt: now,
      createdAt: existingIndex >= 0 ? novel.chapters[existingIndex].createdAt : now,
    };

    if (existingIndex >= 0) {
      novel.chapters[existingIndex] = chapterData;
    } else {
      novel.chapters.push(chapterData);
    }
    novel.chapters.sort((a, b) => Number(a.number) - Number(b.number));
    novel.updatedAt = now;
    state.activeChapterNumber = chapterNumber;
    state.draftTitle = chapterTitle;
    state.draftContent = content;

    const archive = {
      id: `d${Date.now()}_${Math.random().toString(16).slice(2, 6)}`,
      title: `${novel.title} · 第${chapterNumber}章 ${chapterTitle}`,
      content: content.slice(0, 120),
      words,
      createdAt: now,
      novelId: novel.id,
      chapterNumber,
    };
    state.drafts.unshift(archive);
    if (state.drafts.length > MAX_DRAFT_ARCHIVE) {
      state.drafts = state.drafts.slice(0, MAX_DRAFT_ARCHIVE);
    }

    persistState();
    renderAll();
    analysisHintEl.textContent = `已保存《${novel.title}》第${chapterNumber}章，当前共 ${novel.chapters.length} 章。`;
  }

  function makeUploadedCoverImage(novel) {
    const params = new URLSearchParams({
      kind: "cover",
      seed: String(novel.id || `novel-${Date.now()}`),
      title: String(novel.title || "原创小说"),
      subtitle: String(novel.category || "原创连载"),
      w: "600",
      h: "900",
    });
    return `/assets/generated-image?${params.toString()}`;
  }

  function uploadActiveNovelToStore() {
    const novel = getActiveNovel();
    if (!novel) {
      analysisHintEl.textContent = "请先创建并保存章节后再上传。";
      return;
    }
    const chapterCount = getNovelChapterCount(novel);
    if (chapterCount <= 20) {
      analysisHintEl.textContent = `《${novel.title}》当前 ${chapterCount} 章，需大于 20 章才能上传书城。`;
      return;
    }

    novel.uploaded = true;
    novel.uploadedAt = new Date().toISOString();
    if (!novel.coverImage) {
      novel.coverImage = makeUploadedCoverImage(novel);
    }
    persistState();
    renderAll();
    analysisHintEl.textContent = `《${novel.title}》已上传到书城，可在对应分类中查看。`;
  }

  function openUploadedNovelInCreator(novelId) {
    const novel = state.novels.find((item) => item.id === novelId);
    if (!novel) return;
    state.activeNovelId = novel.id;
    state.activeChapterNumber = getNovelLatestChapterNumber(novel);
    state.selectedBookId = `u-${novel.id}`;
    persistState();
    renderAll();
    analysisHintEl.textContent = `已切换到《${novel.title}》创作区，可继续编辑章节。`;
  }

  function getStoreBooks() {
    const uploadedBooks = state.novels
      .filter((novel) => novel.uploaded && getNovelChapterCount(novel) > 20)
      .map((novel) => {
        const firstChapter = novel.chapters[0] || null;
        const lastChapter = novel.chapters[novel.chapters.length - 1] || null;
        const author = bootstrap.profile?.name || bootstrap.profile?.userId || "原创作者";
        return {
          id: `u-${novel.id}`,
          title: novel.title,
          author,
          category: novel.category || "成长",
          mood: "原创连载",
          blurb: `已连载 ${novel.chapters.length} 章，最近更新：第${lastChapter?.number || 1}章 ${lastChapter?.title || "新章节"}`,
          excerpt:
            (firstChapter?.content || lastChapter?.content || "点击进入创作台继续阅读。")
              .replace(/\s+/g, "")
              .slice(0, 120) + "...",
          coverImage: novel.coverImage || makeUploadedCoverImage(novel),
          isUserUploaded: true,
          localNovelId: novel.id,
        };
      });

    return [...books, ...uploadedBooks];
  }

  function getStoreCategories() {
    const storeBooks = getStoreBooks();
    return ["全部", ...new Set(storeBooks.map((book) => book.category).filter(Boolean))];
  }

  function renderInsights() {
    const result = buildPersonalityModel();
    personaTypeEl.textContent = result.personaType;
    personaSummaryEl.textContent = result.summary;
    if (personaDetailCardsEl) {
      personaDetailCardsEl.innerHTML = `
        <section class="persona-detail-card">
          <h4>阅读画像</h4>
          <p>总阅读 ${result.reading.totalMinutes} 分钟，偏好 ${result.reading.topCategory || "未形成偏好"}，专注度 ${result.reading.focusPercent}% 。</p>
        </section>
        <section class="persona-detail-card">
          <h4>写作画像</h4>
          <p>累计 ${result.writing.wordCount} 字，章节 ${result.writing.draftCount} 条，对话密度 ${Math.round(result.writing.dialogueDensity * 100)}%。</p>
        </section>
        <section class="persona-detail-card">
          <h4>当日建议</h4>
          <p>${result.plan}</p>
        </section>
      `;
    }
    traitRowsEl.innerHTML = result.displayTraits
      .map(
        (item) => `
      <div class="trait-row">
        <span class="trait-label">${item.label}</span>
        <b>${item.value}</b>
      </div>
    `
      )
      .join("");
    fortuneBadgeEl.textContent = `今日运势 ${result.fortune.level}`;
    fortuneTextEl.textContent = result.fortune.text;
    fortuneAdviceEl.textContent = result.fortune.advice;
  }

  function buildPersonalityModel() {
    const readStats = summarizeReading();
    const writingStats = summarizeWriting();

    const openness = clamp(
      35 +
        readStats.categoryWeight.科幻 * 16 +
        readStats.categoryWeight.奇幻 * 14 +
        readStats.categoryWeight.历史 * 10 +
        writingStats.creativeKeywords * 3 +
        Math.min(writingStats.wordCount / 70, 18),
      0,
      99
    );

    const conscientiousness = clamp(
      30 +
        Math.min(readStats.totalMinutes / 8, 24) +
        Math.min(state.drafts.length * 6, 24) +
        Math.min(writingStats.wordCount / 95, 18),
      0,
      99
    );

    const extraversion = clamp(
      28 +
        writingStats.dialogueDensity * 22 +
        writingStats.socialWords * 4 +
        readStats.categoryWeight.现实 * 11,
      0,
      99
    );

    const agreeableness = clamp(
      34 +
        readStats.categoryWeight.情感 * 16 +
        readStats.categoryWeight.治愈 * 14 +
        writingStats.empathyWords * 4,
      0,
      99
    );

    const emotionalStability = clamp(
      42 +
        readStats.categoryWeight.治愈 * 14 +
        readStats.categoryWeight.成长 * 12 -
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
    const displayTraits = traits.filter((item) => item.key !== "agreeableness");

    const personaType = derivePersonaType(traits);
    const summary = deriveSummary(traits, readStats, writingStats);
    const fortune = buildDailyFortune(traits, readStats, writingStats);
    const plan = buildPersonaPlan(readStats, writingStats, traits);
    return { traits, displayTraits, personaType, summary, fortune, plan, reading: readStats, writing: writingStats };
  }

  function summarizeReading() {
    const totalMinutes = Object.values(state.readMinutes).reduce((sum, n) => sum + n, 0);
    const categoryMinutes = {};
    getStoreBooks().forEach((book) => {
      const minutes = state.readMinutes[book.id] || 0;
      categoryMinutes[book.category] = (categoryMinutes[book.category] || 0) + minutes;
    });
    const sortedCategories = Object.entries(categoryMinutes)
      .filter(([, minutes]) => minutes > 0)
      .sort((a, b) => b[1] - a[1]);
    const topCategory = sortedCategories[0]?.[0] || "";
    const topCategoryMinutes = sortedCategories[0]?.[1] || 0;
    const activeCategoryCount = sortedCategories.length;
    const focusPercent = totalMinutes ? Math.round((topCategoryMinutes / totalMinutes) * 100) : 0;
    const categoryWeight = {};
    Object.keys(categoryMinutes).forEach((category) => {
      categoryWeight[category] = totalMinutes
        ? categoryMinutes[category] / totalMinutes
        : 0;
    });
    return {
      totalMinutes,
      categoryMinutes,
      categoryWeight,
      topCategory,
      topCategoryMinutes,
      activeCategoryCount,
      focusPercent,
    };
  }

  function summarizeWriting() {
    const chapterTexts = state.novels.flatMap((novel) =>
      (novel.chapters || []).map((chapter) => String(chapter.content || ""))
    );
    const latestDraft = `${state.draftTitle || ""}\n${state.draftContent || ""}`.trim();
    const sampledText = [...chapterTexts.slice(-30), latestDraft].join("\n");
    const wordCount = chapterTexts.reduce((sum, text) => sum + countCharacters(text), 0) +
      countCharacters(latestDraft);
    const quoteCount = countPattern(sampledText, /[“”"「」『』]/g);
    const dialogueDensity = quoteCount / Math.max(countCharacters(sampledText), 1);
    return {
      wordCount,
      dialogueDensity: clamp(dialogueDensity * 100, 0, 1),
      draftCount: state.novels.reduce((sum, novel) => sum + getNovelChapterCount(novel), 0),
      creativeKeywords: countKeyword(sampledText, ["星", "梦", "海", "光", "影", "雾", "荒原", "时空"]),
      empathyWords: countKeyword(sampledText, ["理解", "陪伴", "拥抱", "温柔", "想念", "守护", "心事"]),
      socialWords: countKeyword(sampledText, ["我们", "朋友", "一起", "对话", "分享", "团队"]),
      negativeWords: countKeyword(sampledText, ["焦虑", "崩溃", "绝望", "失控", "孤独", "烦躁"]),
    };
  }

  function derivePersonaType(traits) {
    const sorted = [...traits].sort((a, b) => b.value - a.value);
    const first = sorted[0].key;
    const second = sorted[1].key;
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
    const read = readStats.totalMinutes;
    const words = writingStats.wordCount;
    const readSignal =
      read > 0
        ? `阅读上你在“${readStats.topCategory || "多分类"}”投入最多（${readStats.topCategoryMinutes} 分钟），总阅读 ${read} 分钟。`
        : "当前阅读样本较少，建议先连续阅读 20 分钟以上。";
    const writeSignal =
      words > 0
        ? `写作上累计 ${words} 字、草稿 ${writingStats.draftCount} 条，对话表达强度 ${Math.round(
            writingStats.dialogueDensity * 100
          )}%。`
        : "当前写作样本较少，建议先写 200 字以上再看画像。";
    return `你当前最突出的特质是“${top.label}”。${readSignal}${writeSignal}`;
  }

  function buildDailyFortune(traits, readStats, writingStats) {
    const readingDepth = clamp(readStats.totalMinutes / 180, 0, 1);
    const readingFocus = readStats.totalMinutes
      ? clamp(readStats.topCategoryMinutes / readStats.totalMinutes, 0, 1)
      : 0;
    const readingDiversity = clamp(readStats.activeCategoryCount / 5, 0, 1);
    const writingVolume = clamp(writingStats.wordCount / 1200, 0, 1);
    const writingConsistency = clamp(writingStats.draftCount / 6, 0, 1);
    const writingExpression = clamp(
      (writingStats.dialogueDensity + clamp(writingStats.creativeKeywords / 10, 0, 1)) / 2,
      0,
      1
    );
    const emotionBalance = clamp(
      0.55 + (writingStats.empathyWords - writingStats.negativeWords) * 0.06,
      0,
      1
    );

    const score = Math.round(
      clamp(
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

    const text = `基于你的阅读习惯（${readStats.totalMinutes} 分钟，偏好 ${
      readStats.topCategory || "未形成偏好"
    }）和写作习惯（${writingStats.wordCount} 字，${writingStats.draftCount} 条草稿），今日创作势能为 ${score}/100。`;

    let advice = "适合补设定和修文，把细节打磨得更有质感。";
    if (writingVolume < 0.2) {
      advice = "先写 200-300 字热身段落，再推进主线，今天状态会更稳。";
    } else if (readingDepth < 0.2) {
      advice = "先连续阅读 20 分钟同类题材，再进入写作，灵感会更集中。";
    } else if (emotionBalance < 0.4) {
      advice = "今天宜放慢节奏，先整理情绪和大纲，再推进正文。";
    } else if (level === "大吉") {
      advice = "适合开新坑或发布新章节，读者反馈概率更高。";
    } else if (level === "中吉") {
      advice = "适合推进主线情节，保持节奏就会有亮点。";
    } else if (level === "收敛") {
      advice = "建议先读后写，用阅读校准节奏，再推进关键章节。";
    }

    return { level, text, advice };
  }

  function buildPersonaPlan(readStats, writingStats, traits) {
    const topTrait = [...traits].sort((a, b) => b.value - a.value)[0];
    if (readStats.totalMinutes < 20 && writingStats.wordCount < 200) {
      return "先完成 20 分钟连续阅读 + 200 字热身写作，再分析会更稳定。";
    }
    if (readStats.topCategory && writingStats.wordCount < 400) {
      return `围绕“${readStats.topCategory}”继续写 300-500 字，能明显提升画像可信度。`;
    }
    if (writingStats.dialogueDensity > 0.45) {
      return `你当前“${topTrait.label}”较强，建议补一段环境描写，让叙事层次更完整。`;
    }
    return `保持同一题材连续创作 3 天，你的“${topTrait.label}”画像会更清晰。`;
  }

  function countKeyword(text, words) {
    const source = (text || "").toLowerCase();
    return words.reduce((sum, word) => {
      const escaped = word.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
      const match = source.match(new RegExp(escaped, "gi"));
      return sum + (match ? match.length : 0);
    }, 0);
  }

  function countPattern(text, pattern) {
    const match = (text || "").match(pattern);
    return match ? match.length : 0;
  }

  function countCharacters(text) {
    return (text || "").replace(/\s+/g, "").length;
  }

  function shortText(text, maxLength) {
    const source = String(text || "").trim();
    if (!source) return "";
    if (source.length <= maxLength) return source;
    return `${source.slice(0, maxLength)}…`;
  }

  function clamp(value, min, max) {
    return Math.max(min, Math.min(max, value));
  }

  function hashToPercent(text) {
    let hash = 0;
    for (let i = 0; i < text.length; i += 1) {
      hash = (hash * 31 + text.charCodeAt(i)) >>> 0;
    }
    return hash % 100;
  }

  function formatDate(date) {
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, "0");
    const day = String(date.getDate()).padStart(2, "0");
    return `${year}-${month}-${day}`;
  }

  function formatShortDate(date) {
    const month = String(date.getMonth() + 1).padStart(2, "0");
    const day = String(date.getDate()).padStart(2, "0");
    const hh = String(date.getHours()).padStart(2, "0");
    const mm = String(date.getMinutes()).padStart(2, "0");
    return `${month}-${day} ${hh}:${mm}`;
  }

  function parseTimeValue(value) {
    const parsed = new Date(value || "").getTime();
    return Number.isFinite(parsed) ? parsed : 0;
  }

  function normalizeHeroBio(rawBio) {
    const source = String(rawBio || "").trim();
    if (!source) return "";
    return source
      .replace(/\r\n/g, "\n")
      .replace(/\n?#{2,6}\s*/g, "\n")
      .replace(/\s*#{2,6}\n?/g, "\n")
      .replace(/[ \t]+\n/g, "\n")
      .replace(/\n{3,}/g, "\n\n")
      .trim();
  }

  function buildSnapshotFromState() {
    return {
      selectedCategory: state.selectedCategory,
      selectedBookId: state.selectedBookId,
      readMinutes: state.readMinutes,
      draftTitle: state.draftTitle,
      draftContent: state.draftContent,
      drafts: state.drafts,
      novels: state.novels,
      activeNovelId: state.activeNovelId,
      activeChapterNumber: state.activeChapterNumber,
      updatedAt: state.updatedAt || new Date().toISOString(),
    };
  }

  function applySnapshotToState(snapshot) {
    if (!snapshot || typeof snapshot !== "object") return;
    state.selectedCategory = snapshot.selectedCategory || "全部";
    state.selectedBookId = snapshot.selectedBookId || state.selectedBookId || "";
    state.readMinutes = mergeReadMinutes(
      snapshot.readMinutes || {},
      readingBootstrap.readMinutesByBook || {}
    );
    state.draftTitle = String(snapshot.draftTitle || "");
    state.draftContent = String(snapshot.draftContent || "");
    state.drafts = Array.isArray(snapshot.drafts) ? snapshot.drafts : [];
    state.novels = normalizeNovels(snapshot.novels || []);
    state.activeNovelId = snapshot.activeNovelId || "";
    state.activeChapterNumber = normalizeChapterNumber(snapshot.activeChapterNumber || 1);
    state.updatedAt = snapshot.updatedAt || new Date().toISOString();
  }

  function chooseFresherSnapshot(localSnapshot, remoteSnapshot) {
    const local = localSnapshot && typeof localSnapshot === "object" ? localSnapshot : {};
    const remote = remoteSnapshot && typeof remoteSnapshot === "object" ? remoteSnapshot : {};
    const localTime = parseTimeValue(local.updatedAt);
    const remoteTime = parseTimeValue(remote.updatedAt);

    if (remoteTime > localTime) {
      return {
        ...local,
        ...remote,
        readMinutes: mergeReadMinutes(local.readMinutes || {}, remote.readMinutes || {}),
      };
    }
    return {
      ...remote,
      ...local,
      readMinutes: mergeReadMinutes(local.readMinutes || {}, remote.readMinutes || {}),
    };
  }

  async function hydrateStateFromServer() {
    const localSnapshot = buildSnapshotFromState();
    try {
      const response = await fetch("/api/state", {
        method: "GET",
        headers: { Accept: "application/json" },
      });
      if (!response.ok) return;
      const payload = await response.json().catch(() => null);
      if (!payload || payload.code !== 0) return;
      const remoteSnapshot = payload.data && typeof payload.data === "object" ? payload.data : {};
      if (!remoteSnapshot.updatedAt && payload.updatedAt) {
        remoteSnapshot.updatedAt = payload.updatedAt;
      }
      const mergedSnapshot = chooseFresherSnapshot(localSnapshot, remoteSnapshot);
      applySnapshotToState(mergedSnapshot);
      localStorage.setItem(storageKey, JSON.stringify(mergedSnapshot));

      const remoteTime = parseTimeValue(remoteSnapshot.updatedAt);
      const localTime = parseTimeValue(localSnapshot.updatedAt);
      if (localTime > remoteTime + 1000) {
        queueServerSync(mergedSnapshot);
      }
    } catch {
      // 网络异常时保留本地状态
    }
  }

  function queueServerSync(snapshot) {
    syncState.queuedSnapshot = snapshot;
    if (syncState.timer) clearTimeout(syncState.timer);
    syncState.timer = window.setTimeout(() => {
      syncState.timer = null;
      flushServerSync();
    }, 420);
  }

  async function flushServerSync() {
    if (syncState.inFlight || !syncState.queuedSnapshot) return;
    const payload = syncState.queuedSnapshot;
    syncState.queuedSnapshot = null;
    syncState.inFlight = true;
    try {
      await fetch("/api/state", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
    } catch {
      // 忽略同步失败，保留本地存档
    } finally {
      syncState.inFlight = false;
      if (syncState.queuedSnapshot) {
        flushServerSync();
      }
    }
  }

  function loadState() {
    try {
      const raw = localStorage.getItem(storageKey);
      return raw ? JSON.parse(raw) : {};
    } catch {
      return {};
    }
  }

  function mergeReadMinutes(localMap, remoteMap) {
    const merged = {};
    const keys = new Set([
      ...Object.keys(localMap || {}),
      ...Object.keys(remoteMap || {}),
    ]);
    keys.forEach((key) => {
      const localVal = Number(localMap?.[key] || 0);
      const remoteVal = Number(remoteMap?.[key] || 0);
      merged[key] = Math.max(localVal, remoteVal);
    });
    return merged;
  }

  function normalizeNovels(rawNovels) {
    if (!Array.isArray(rawNovels)) return [];
    return rawNovels
      .map((item) => {
        const chapters = Array.isArray(item?.chapters)
          ? item.chapters
              .map((chapter, index) => ({
                id: String(chapter?.id || `legacy_${item?.id || "n"}_${index + 1}`),
                number: normalizeChapterNumber(chapter?.number || index + 1),
                title: String(chapter?.title || `第${index + 1}章`),
                content: String(chapter?.content || ""),
                words: Number(chapter?.words || countCharacters(chapter?.content || "")),
                createdAt: chapter?.createdAt || new Date().toISOString(),
                updatedAt: chapter?.updatedAt || chapter?.createdAt || new Date().toISOString(),
              }))
              .sort((a, b) => a.number - b.number)
          : [];

        const normalizedId = String(
          item?.id || `novel_${Date.now()}_${Math.random().toString(16).slice(2, 6)}`
        );
        const normalizedTitle = String(item?.title || "未命名小说");
        const normalizedCategory = String(item?.category || creatorCategories[0]);
        const rawCoverImage = item?.coverImage ? String(item.coverImage) : "";
        const coverImage =
          !rawCoverImage || rawCoverImage.includes("source.unsplash.com")
            ? makeUploadedCoverImage({
                id: normalizedId,
                title: normalizedTitle,
                category: normalizedCategory,
              })
            : rawCoverImage;

        return {
          id: normalizedId,
          title: normalizedTitle,
          category: normalizedCategory,
          createdAt: item?.createdAt || new Date().toISOString(),
          updatedAt: item?.updatedAt || item?.createdAt || new Date().toISOString(),
          uploaded: Boolean(item?.uploaded),
          uploadedAt: item?.uploadedAt || null,
          coverImage,
          chapters,
        };
      })
      .filter((item) => item.title.trim());
  }

  function persistState() {
    state.updatedAt = new Date().toISOString();
    const snapshot = buildSnapshotFromState();
    localStorage.setItem(storageKey, JSON.stringify(snapshot));
    if (syncState.hydrated) {
      queueServerSync(snapshot);
    }
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
