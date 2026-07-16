import type {
  CacheStatus,
  CreditPreviewFreeReason,
  MemberCreditChargeReason,
  MovieRequestStatus
} from "@wwpdw/shared";
import type { ManagedMemberCode, ManagedMemberInvitation } from "./types";

export const zhCN = {
  app: {
    name: "WWP",
    tagline: "",
    screeningRoom: ""
  },
  common: {
    admin: "管理员",
    member: "成员",
    cinemaMember: "成员",
    back: "返回",
    cancel: "取消",
    close: "关闭",
    confirm: "确认",
    continue: "继续",
    delete: "删除",
    refresh: "刷新",
    search: "搜索",
    loading: "加载中",
    unknown: "未知",
    notRecorded: "未记录",
    notReady: "未就绪",
    copied: "已复制",
    enabled: "是",
    disabled: "否",
    items: "项"
  },
  access: {
    enter: "进入",
    join: "加入",
    joinHousehold: "加入",
    resetPasscode: "重置通行码",
    passcode: "通行码",
    newPasscode: "新通行码",
    confirmPasscode: "确认通行码",
    displayName: "显示名称",
    householdInvitation: "邀请码",
    resetInvitation: "重置码",
    forgot: "忘记了？",
    resetHelp: "请输入管理员提供的重置码，然后设置新的通行码。如果你没有重置码，请先向管理员索要。",
    passcodeRule: "通行码为 6 位字符。",
    restoringSession: "正在恢复登录状态",
    wake: {
      title: "服务唤醒中",
      correct: "答对了",
      wrong: "差一点",
      yourAnswer: "你的答案",
      correctAnswer: "正确答案",
      pause: "暂停",
      next: "下一题",
      idle: "银幕还在亮起来。当前题不会计时，答完会给出结果和解析。"
    },
    errors: {
      enterPasscode: "请输入通行码。",
      enterNewPasscode: "请输入新的通行码。",
      enterInvite: "请输入邀请码。",
      enterName: "请输入显示名称。",
      enterResetInvite: "请输入重置码。",
      mismatch: "两次输入的通行码不一致。",
      registerFailed: "无法加入。",
      resetFailed: "无法重置通行码。",
      passcodeMismatch: "通行码不匹配。"
    }
  },
  layout: {
    browseLabel: "浏览频道",
    homeTitle: "返回推荐首页",
    help: "帮助",
    account: "账号",
    spending: "消费记录",
    forum: "讨论",
    tasks: "缓存任务",
    history: "播放历史",
    favorites: "我的收藏",
    watchlist: "今晚看什么",
    nowPlaying: "热映观察",
    admin: "管理台",
    themeLight: "亮色",
    themeDark: "暗色",
    themeToLight: "切换亮色",
    themeToDark: "切换暗色",
    request: "求片",
    settings: "账号设置",
    logout: "退出",
    browseChannels: {
      recommended: "推荐",
      movie: "电影",
      tv: "电视",
      animation: "动画"
    }
  },
  search: {
    title: "搜索片库",
    description: "在 WWP 片库中查找影片。",
    placeholder: "搜索电影、剧集、导演或片源",
    searching: "正在搜索",
    start: "输入关键词开始搜索",
    viewAll: "查看全部",
    chooseResult: "选择一个结果查看详情",
    idle: "可以搜片名、英文名、导演、演员或清晰度关键词。",
    empty: (query: string) => `没有找到“${query}”`,
    resultCount: (count: number) => `${count} 个结果`
  },
  library: {
    galleryView: "海报视图",
    gallery: "海报",
    listView: "列表视图",
    list: "列表",
    noTitlesFound: "没有找到影片",
    noTitlesLoaded: "暂无影片",
    missingSummary: "暂无影片简介",
    table: {
      title: "片名",
      metadata: "信息",
      people: "类型/人物",
      specs: "规格"
    },
    browseViews: {
      lucky: { label: "幸运之星", detail: "页面刷新时随机换一组" },
      recent: { label: "最近更新", detail: "按目录更新时间排列" },
      newGood: { label: "近期佳片", detail: "新片优先，兼顾评分" },
      popular: { label: "热门佳片", detail: "播放与评分综合排序" },
      topRated: { label: "评价最高", detail: "优先展示评分条目" },
      mostWatched: { label: "观看最高", detail: "按家庭播放记录排序" },
      tspdtRank: { label: "TSPDT 1000", detail: "按 TSPDT 影史榜顺序排列" },
      doubanRank: { label: "豆瓣排名", detail: "按豆瓣评分优先排列" },
      imdbRank: { label: "IMDb 排名", detail: "按 IMDb 评分优先排列" },
      rottenRank: { label: "烂番茄排名", detail: "按烂番茄评分优先排列" }
    },
    loadMore: "加载更多",
    loadedAll: (count: number) => `已显示 ${count}`,
    loadedLimit: (count: number) => `已显示前 ${count} 条，换个视图或直接搜索会更快`,
    tspdtMatched: (matched: number, total: number) => `命中 ${matched}/${total}`,
    tspdtCatalogLoaded: (count: number, hasMore: boolean) => `已加载 ${count}${hasMore ? "+" : ""}`,
    continueLoading: "继续加载更多影片",
    emptyBrowse: "暂无可浏览影片",
    noVariants: "无规格",
    viewDetails: "查看详细信息",
    viewAllVariants: "查看全部规格",
    directDownload: "直接下载",
    summaryTitle: "完整简介",
    aiSummary: "AI 简介",
    aiSummaryTitle: "AI 剧情简介",
    aiSummaryDescription: "用快速档生成一段可读简介。",
    spoilerFree: "非剧透",
    spoiler: "剧透版",
    aiSummaryLoading: "正在生成简介",
    aiSummaryEmpty: "选择一个版本后生成简介。",
    moreVariants: (count: number) => `还有 ${count} 个规格`,
    variantCount: (count: number) => `${count} 个规格`,
    playableVariantCount: (count: number) => `${count} 个可播放`,
    director: (name: string) => `导演 ${name}`,
    ageRecommendationTitle: "年龄建议",
    ageRecommendation: (age: number) => `建议 ${age}+`,
    aiAgeSource: "AI建议",
    manualAgeSource: "人工覆盖",
    ageConfidence: {
      high: "高置信",
      medium: "中等置信",
      low: "低置信"
    },
    backToList: "返回列表",
    intro: "简介",
    allVariants: "全部规格",
    browseLoadingLabel: "正在加载浏览目录",
    ignoredSourceTag: "闻达",
    ratingSources: {
      douban: "豆瓣",
      imdb: "IMDb",
      rotten: "烂番茄",
      metacritic: "Metacritic",
      metaShort: "Meta"
    }
  },
  cachedShelf: {
    loading: "正在加载已缓存影片",
    empty: "暂无已缓存影片",
    playableCount: (count: number) => `${count} 可播放`
  },
  history: {
    empty: "暂无播放历史",
    clear: "清空历史",
    recacheHint: "需要先重新搜索这条影片，才能再次准备。"
  },
  favorites: {
    title: "我的收藏",
    description: "把喜欢、想看和已看分开放，之后想找回来就不用重新翻片库。",
    count: (count: number) => `${count} 部影视`,
    empty: "还没有标记影片",
    emptyHint: "在片库里点星星，或进入详情标记想看、已看，就会加入这里。",
    addedAt: (date: string) => `收藏 ${date}`,
    wantToWatchAt: (date: string) => `想看 ${date}`,
    watchedAt: (date: string) => `已看 ${date}`,
    remove: "取消收藏",
    removeWantToWatch: "取消想看",
    removeWatched: "取消已看",
    open: "查看详情",
    noPlayableVariant: "暂无可用规格",
    favorite: "收藏",
    unfavorite: "取消收藏",
    wantToWatch: "想看",
    unwantToWatch: "取消想看",
    watched: "已看",
    unwatched: "取消已看",
    sections: {
      favorite: "喜欢",
      wantToWatch: "想看",
      watched: "已看"
    },
    sectionEmpty: {
      favorite: "还没有喜欢的影片",
      wantToWatch: "还没有想看的影片",
      watched: "还没有标记已看的影片"
    }
  },
  watchlist: {
    title: "今晚看什么",
    description: "像视频网站一样按类型、地区和年代缩小范围，先把选择变少一点。",
    available: (count: number) => `${count} 部影片`,
    matched: (count: number) => `筛出 ${count} 部`,
    cachedReady: (count: number) => `${count} 部已缓存`,
    loadingCatalog: "正在加载片库",
    loadMore: "加载更多片库",
    filtersTitle: "筛选",
    rows: {
      sort: "排序",
      category: "大类",
      cost: "资费",
      type: "类型",
      region: "地区",
      year: "年份"
    },
    categories: {
      all: "全部",
      movie: "电影",
      tv: "电视"
    },
    costs: {
      all: "全部片库",
      ready: "已缓存",
      freeReplay: "免费播放时间内"
    },
    sort: {
      latest: "最新",
      rating: "高分好评",
      cached: "最近缓存"
    },
    all: "全部",
    play: "播放",
    prepare: "准备",
    viewReadyOnlyHint: "资费选中已缓存或免费播放时，只显示已经准备好的可播内容。",
    replayFree: "免费播放中",
    noPlayableVariant: "暂无可用规格",
    loading: "正在加载可播放影片",
    empty: "还没有可选影片",
    emptyFilter: "这个条件下没有影片",
    cachedAt: (date: string) => `缓存 ${date}`,
    updatedAt: (date: string) => `更新 ${date}`,
    refresh: "刷新片单"
  },
  nowPlaying: {
    title: "热映观察",
    description: "给出门看电影前看的几件事：现在有什么、哪部适合大屏、哪部先观望、后面有什么。",
    source: "猫眼专业版",
    doubanSource: "豆瓣上海",
    sourceHint: "低频读取公开页面数据，验证阶段使用",
    refresh: "刷新热映",
    refreshing: "正在刷新",
    loading: "正在加载热映数据",
    empty: "暂时没有热映数据",
    stale: "正在显示上一次可用数据",
    observedAt: (date: string) => `观察时间 ${date}`,
    fetchedAt: (date: string) => `读取 ${date}`,
    cacheHit: "缓存",
    cacheRefresh: "已刷新",
    cacheStale: "旧数据",
    rank: (rank: number) => `#${rank}`,
    totalBox: "累计票房",
    showRate: "排片占比",
    showCount: "排片场次",
    avgShow: "场均人次",
    seatRate: "上座率",
    boxRate: "票房占比",
    proData: "专业版",
    ticket: "购票",
    doubanRating: "豆瓣",
    doubanVotes: (count: string) => `${count} 人评分`,
    doubanWish: (count: string) => `${count} 人想看`,
    noRating: "暂无评分",
    guide: {
      current: {
        title: "现在热映",
        detail: "影院正在放什么"
      },
      bigScreen: {
        title: "值得大屏",
        detail: "热度、排片和转化都更稳"
      },
      caution: {
        title: "避雷观察",
        detail: "热度和排片不匹配，先看看口碑"
      },
      upcoming: {
        title: "即将上映",
        detail: "豆瓣想看人数和上映日"
      }
    },
    sections: {
      bigScreen: "值得出门看",
      caution: "先观望一下",
      current: "热映列表",
      upcoming: "明天 / 下周"
    },
    upcomingBody: "固定上海档期，按豆瓣即将上映信息展示上映日、类型和想看人数。",
    noCaution: "暂时没有明显需要观望的片子。",
    recommendation: {
      heat: "市场热度高",
      efficient: "排片转化好",
      newRelease: "新上映",
      stable: "持续观察"
    }
  },
  tasks: {
    title: "缓存任务",
    description: "准备中的任务和可播放的缓存内容",
    preparing: "准备中",
    cached: "已缓存",
    mine: "我的",
    publicPool: "公共池",
    noPreparing: "没有准备中的任务",
    loadingCached: "正在加载已缓存内容",
    emptyCached: "这里还没有已缓存内容",
    floatingTitle: "缓存任务",
    currentTitle: "当前准备任务",
    noCurrent: "本次浏览器还没有正在准备的影片",
    browserTasks: "本次浏览器发起的准备任务",
    viewAllTitle: "查看全部任务",
    collapse: "收起",
    collapseSr: "收起任务浮窗",
    viewAllCount: (count: number) => `查看全部 ${count} 项`
  },
  player: {
    nowPlaying: "正在播放",
    back: "返回影院",
    expiresAt: (date: string) => `播放链接有效期至 ${date}`
  },
  help: {
    title: "使用说明",
    nav: {
      home: "首页",
      faq: "常见问题",
      academy: "小课堂"
    },
    rules: [
      {
        title: "为什么会有这个网站",
        body: "外面的视频网站已经很多，为什么还要做一个家庭影视网站？大概是一点不合格影迷的最后倔强：老片、稀有版本、特色版本、字幕偏好、配音偏好、原盘收藏，再加上一点技术实践，所以有此一举。"
      },
      {
        title: "先想清楚再准备",
        body: "很多片子不是天然在线流媒体。点规格后，系统要去确认片源、搬到播放缓存、检查能不能在线播放；这一步会占用服务器、存储和网络流量。"
      },
      {
        title: "代币是用量感觉",
        body: "🍀 代币不是为了卡住大家，而是让每个人对用量有直观感觉。代币不够可以找管理员索取，但请尽量避免误点、重复准备和随手试大文件。"
      },
      {
        title: "缓存为什么要花钱",
        body: "缓存就是把片子提前放到可以播放的位置。它会占空间，也会产生上传、下载和保存成本；片子越大、规格越高，准备一次消耗越明显。"
      },
      {
        title: "播放也会另花钱",
        body: "缓存好了不代表后续播放完全免费。在线播放会持续走网络流量，尤其是长片和高清规格；所以真正开始看时，还会按播放规则确认观看代币。"
      },
      {
        title: "命中缓存就少浪费",
        body: "如果别人已经准备过，或同一部片还在缓存期内，你可以直接播放，速度也更快。短时间内重看同一部片通常不会重复收取观看代币。"
      },
      {
        title: "不会开放充值",
        body: "这里不会放充值入口，也不会把代币做成付费购买。基础设施成本很现实，所以欢迎赞助；开发和维护主要是用爱发电，会尽量把功能做好，但不作商业服务式的保证。"
      },
      {
        title: "找不到再请求",
        body: "搜索不到、规格不对、或者确实想补片，可以在账号菜单里提交求片请求。最好写清片名、年份、版本、字幕、配音或集数，管理员会看情况补进片库。"
      },
      {
        title: "不要宣传外传",
        body: "这个站只给熟人小范围使用。不要公开宣传，不要分享通行码、播放链接或缓存内容；如果想推荐给线下亲友，先找管理员商量。"
      }
    ],
    flowTitle: "简单流程",
    flowBody: "先在推荐、电影、电视、动画里挑片；确定真的要看，再选择合适规格。如果还没准备好，就等它完成缓存；准备完成后再确认播放。看过的片子会进播放历史，已缓存的片子可以从账号菜单里的缓存任务找到。",
    faqTitle: "先解决眼前问题",
    faqDescription: "遇到播放、代币、缓存、求片这些问题，可以先在这里查。写得尽量像管理员当面解释，不像产品手册。",
    faqSearchPlaceholder: "搜索代币、缓存、播放、字幕、求片...",
    faqEmpty: "没有匹配的问题，可以换个词试试，或者直接找管理员。",
    faqCategories: [
      { id: "all", label: "全部" },
      { id: "start", label: "新手" },
      { id: "credit", label: "代币" },
      { id: "cache", label: "缓存" },
      { id: "playback", label: "播放" },
      { id: "request", label: "求片" },
      { id: "account", label: "账号" }
    ],
    faqItems: [
      {
        category: "start",
        question: "第一次进来应该怎么用？",
        answer: "先从推荐、电影、电视、动画里挑片，点进去看简介和规格。确定真的要看，再选一个合适规格；如果还没有缓存，就等系统准备完成，最后再确认播放。"
      },
      {
        category: "cache",
        question: "为什么不能像视频网站一样点开就播？",
        answer: "这里很多片子来自收藏片源，不是一直放在在线播放线路上。第一次观看前，系统要把片源整理到缓存位置，确认格式、网络和播放链接都可用。"
      },
      {
        category: "credit",
        question: "代币是充值货币吗？",
        answer: "不是。这里不会开放充值入口。代币更像用量提醒，让大家知道准备缓存和在线播放都不是零成本；不够用可以找管理员补。"
      },
      {
        category: "credit",
        question: "为什么准备和播放可能分开扣？",
        answer: "准备缓存是在服务器侧搬运、保存和检查文件；播放是你真正在线观看时产生的网络流量，按约 100MB 计 1🍀。两件事消耗的资源不同，所以会分开确认。"
      },
      {
        category: "cache",
        question: "别人准备过的片我还要再准备吗？",
        answer: "通常不用。如果同一个版本还在缓存期内，你会直接命中缓存，速度更快，也能减少重复消耗。缓存过期或版本不同，才可能需要重新准备。"
      },
      {
        category: "playback",
        question: "为什么有免费重看窗口？",
        answer: "短时间内重看同一部片，通常不应该反复收观看代币。免费重看窗口就是为了避免误触或中途退出后重新打开造成浪费。"
      },
      {
        category: "playback",
        question: "播放卡顿应该先检查什么？",
        answer: "先看网络是否稳定，再试试降低规格、换浏览器或重新打开播放页。高清大文件对网络更敏感，尤其是 4K、HDR、原盘规格。"
      },
      {
        category: "request",
        question: "求片怎么写更容易被处理？",
        answer: "尽量写清片名、年份、导演或主演、想要的版本、字幕和配音偏好。能附豆瓣、IMDb 或 TMDb 链接最好，管理员就不容易找错。"
      },
      {
        category: "request",
        question: "为什么有些片暂时不会补？",
        answer: "可能是片源不好找、版本不合适、字幕缺失、文件太大，或者当前维护时间不够。求片是愿望单，不是工单承诺。"
      },
      {
        category: "account",
        question: "可以把通行码发给别人吗？",
        answer: "不要公开分享通行码、播放链接或缓存内容。如果想推荐线下亲友使用，先找管理员商量，避免片库变成不可控的公开站。"
      },
      {
        category: "start",
        question: "看完以后在哪里找历史记录？",
        answer: "看过的内容会进入播放历史。已经准备好的缓存内容，也可以从账号菜单里的缓存任务或已缓存入口里找。"
      },
      {
        category: "playback",
        question: "为什么同一部片会有多个规格？",
        answer: "不同规格可能代表清晰度、来源、码率、字幕、音轨或版本差异。普通观看优先选合适大小和稳定播放，不一定总要选最大的。"
      }
    ],
    lessonsTitle: "平时可以慢慢看的小课堂",
    lessonsDescription: "这些不是必须一次看完的说明书，更像家庭片库的知识卡。没事翻一翻，会更懂怎么选片、怎么省资源，也更懂影视版本和工具。",
    lessonOpenLabel: "阅读",
    lessons: [
      {
        id: "starter",
        title: "第一次使用路线",
        kicker: "新手入门",
        summary: "从进站、找片、选规格、等待缓存到播放历史，按真实使用顺序走一遍。",
        tags: ["找片", "规格", "历史"],
        points: [
          "先用频道和搜索缩小范围，不要看到多个版本就随手全点。",
          "选规格时优先考虑设备和网络，手机或普通电视不一定需要最大文件。",
          "准备完成后再确认播放，看过的内容可以从历史和缓存入口回看。"
        ]
      },
      {
        id: "credits",
        title: "代币与基础设施成本",
        kicker: "用量感觉",
        summary: "解释代币为什么存在，以及缓存、存储、播放流量各自花在哪里。",
        tags: ["代币", "成本", "节约"],
        points: [
          "代币不是充值体系，而是让用量变得可见。",
          "缓存会占用服务器、对象存储和传输资源。",
          "在线播放本身也会产生流量，所以播放确认和缓存确认是两回事。"
        ]
      },
      {
        id: "cache",
        title: "缓存与在线播放",
        kicker: "幕后流程",
        summary: "用普通话解释片源、缓存、播放链接、有效期和重看窗口。",
        tags: ["缓存", "链接", "重看"],
        points: [
          "片源像仓库里的原材料，缓存像临时摆到柜台上的可播放版本。",
          "播放链接通常有有效期，过期后需要重新生成或检查。",
          "命中缓存能节省准备时间，也能避免重复搬运大文件。"
        ]
      },
      {
        id: "versions",
        title: "怎么看影视版本",
        kicker: "版本知识",
        summary: "认识 Web-DL、Blu-ray、Remux、UHD、修复版和导演剪辑版的基本差异。",
        tags: ["Blu-ray", "Remux", "UHD"],
        points: [
          "Web-DL 通常来自流媒体，体积适中，兼容性较好。",
          "Remux 更接近原盘质量，文件很大，对网络和设备要求更高。",
          "修复版、导演剪辑版、加长版可能内容不同，不只是清晰度不同。"
        ]
      },
      {
        id: "subtitles",
        title: "字幕和配音怎么选",
        kicker: "语言偏好",
        summary: "解释内封字幕、外挂字幕、简繁字幕、双语字幕、国语和粤语音轨。",
        tags: ["字幕", "配音", "音轨"],
        points: [
          "内封字幕跟着视频文件走，外挂字幕更灵活但更依赖匹配。",
          "同一部片可能有原声、国语、粤语或评论音轨，选择前看清说明。",
          "字幕质量会明显影响观感，尤其是老片、方言片和术语多的作品。"
        ]
      },
      {
        id: "quality",
        title: "画质和声音的取舍",
        kicker: "观看体验",
        summary: "用非发烧友语言理解分辨率、码率、HDR、5.1 和 Atmos。",
        tags: ["画质", "HDR", "声音"],
        points: [
          "分辨率只是一个指标，码率、来源和压制质量也很重要。",
          "HDR、杜比视界需要设备支持，否则未必比普通版本更适合。",
          "多声道音轨在电视和音响上更明显，在手机上差别可能有限。"
        ]
      },
      {
        id: "tools",
        title: "浏览器、播放器和投屏",
        kicker: "工具知识",
        summary: "介绍什么时候用浏览器就够，什么时候需要换设备、换播放器或投屏。",
        tags: ["浏览器", "投屏", "设备"],
        points: [
          "普通在线播放先用现代浏览器，遇到问题再换浏览器或设备。",
          "投屏质量取决于网络、电视协议和片源规格，不是所有文件都适合投。",
          "如果画面黑屏、没声音或字幕异常，通常和编码、音轨或浏览器支持有关。"
        ]
      },
      {
        id: "requesting",
        title: "如何提出一个好求片",
        kicker: "片库协作",
        summary: "把求片写清楚，可以显著降低找错片、补错版本和反复沟通的概率。",
        tags: ["求片", "版本", "线索"],
        points: [
          "片名、年份、导演主演是基础信息，冷门片尤其需要链接辅助确认。",
          "如果在意字幕、配音、画质或剪辑版本，要在求片时直接写明。",
          "求片不是即时任务，写得越具体，越容易被准确处理。"
        ]
      }
    ]
  },
  profile: {
    title: "账号设置",
    description: "更新你的显示名称和通行码。",
    displayName: "显示名称",
    newPasscode: "新通行码",
    confirmNewPasscode: "确认新通行码",
    save: "保存资料",
    errors: {
      nameRequired: "请输入显示名称。",
      passcodeMismatch: "两次输入的新通行码不一致。"
    }
  },
  passcode: {
    title: "修改通行码",
    current: "当前通行码",
    new: "新通行码",
    confirmNew: "确认新通行码",
    save: "保存通行码",
    errors: {
      currentRequired: "请输入当前通行码。",
      mismatch: "两次输入的新通行码不一致。"
    }
  },
  request: {
    title: "求片",
    description: "告诉家庭片库你想看什么。",
    placeholder: "片名、剧集、集数、年份、演员、语言、版本，或任何你记得的线索...",
    submit: "提交",
    myRequests: "我的请求",
    loading: "正在加载请求",
    empty: "还没有请求。",
    requestedAt: (date: string) => `请求于 ${date}`,
    updatedAt: (date: string) => ` / 更新于 ${date}`,
    errors: {
      describe: "请描述你想看的内容。"
    }
  },
  forum: {
    title: "讨论",
    description: "给成员之间留一个轻量留言板，可以聊片、约时间或补充观看建议。",
    newThread: "发新帖",
    threadList: "帖子",
    publish: "发布",
    reply: "回复",
    sendReply: "发送回复",
    discussion: "讨论",
    me: "我",
    titlePlaceholder: "标题",
    bodyPlaceholder: "想和大家讨论什么？",
    replyPlaceholder: "写下你的回复...",
    loadingThreads: "正在加载帖子",
    loadingThread: "正在打开帖子",
    emptyThreads: "还没有帖子。",
    emptyReplies: "还没有回复。",
    selectThread: "选择一个帖子开始阅读。",
    createdAt: (date: string) => `发布于 ${date}`,
    lastReplyAt: (date: string) => `最后回复 ${date}`,
    replies: (count: number) => `${count} 条回复`,
    errors: {
      titleRequired: "请输入标题。",
      bodyRequired: "请输入正文。",
      replyRequired: "请输入回复内容。"
    }
  },
  credit: {
    confirmTitle: "确认花费",
    confirming: "正在确认本次花费",
    cacheAction: "准备视频",
    playbackAction: "播放视频",
    balance: (amount: string) => `余额 ${amount}`,
    afterCharge: (amount: string) => `扣后 ${amount}`,
    insufficient: (unit: string) => `${unit} 不够了，请先找管理员补充。`,
    spend: (amount: string) => `花费 ${amount}`,
    remainingDuration: {
      hoursMinutes: (hours: number, minutes: number) => `${hours} 小时 ${minutes} 分钟`,
      hours: (hours: number) => `${hours} 小时`,
      minutes: (minutes: number) => `${minutes} 分钟`
    },
    usageTitle: "消费记录",
    usageDescription: "这个通行码近期的代币消费。",
    memberUsageDescription: (name: string, remaining: number, unit: string) => `${name} / 剩余 ${remaining}${unit}`,
    loadingUsage: "正在加载消费记录",
    noUsage: "还没有消费记录。",
    spent: "已消费",
    remaining: "剩余",
    entries: "记录数",
    freeReplayUntil: (date: string) => ` / 免费重看到 ${date}`,
    explanations: {
      cacheActive: "服务器已经在准备这个视频，本次点击不会重复扣费。",
      cacheReady: "这个视频已经准备好，可以进入播放确认。",
      adminCache: "管理员账号准备视频不会扣除 🍀。",
      adminPlayback: "管理员账号播放视频不会扣除 🍀。",
      playbackReplay: "这个视频已经在免费重看窗口内，本次播放免费。",
      playbackReplayWithTime: (remaining: string) => `这个视频已经在免费重看窗口内，本次播放免费，还剩 ${remaining}。`,
      cacheCharge: (credits: string) => `让服务器准备这个视频，需要花费 ${credits}。准备完成后会再确认播放花费。`,
      playbackCharge: (credits: string, hours: number) => `这个视频已经准备好，播放按约 100MB 计 1🍀，本次需要花费 ${credits}。首次点击后，${hours} 小时内重看同一视频免费。`
    }
  },
  admin: {
    unlockTitle: "管理员",
    unlockDescription: "输入管理员密钥，管理成员通行码。",
    adminKey: "管理员密钥",
    unlock: "解锁",
    tabs: {
      cached: "已缓存",
      jobs: "缓存任务",
      passes: "成员",
      invites: "邀请",
      requests: "求片",
      security: "安全"
    },
    requestsTitle: "求片请求",
    requestsDescription: "成员希望补充到片库的影片清单。",
    loadingRequests: "正在加载求片请求",
    noRequests: "暂无求片请求",
    requestId: "请求",
    memberId: "成员",
    status: "状态",
    loginTitle: "登录记录",
    loginDescription: "成功通过通行码校验的网络和设备记录。",
    loadingAudit: "正在加载登录记录",
    noAudit: "暂无登录记录",
    ipUnknown: "未知 IP",
    location: "位置",
    device: "设备",
    unknownDevice: "未知设备",
    bulkBalance: "批量余额",
    bulkDescription: "调整所有有效通行码的代币余额。",
    amount: "🍀 数量",
    addAll: "全部增加",
    subtractAll: "全部扣减",
    activePasses: (count: number) => `${count} 个有效通行码`,
    noMembers: "暂无成员",
    balance: "余额",
    setCredits: "设置 🍀",
    resetInvite: "重置邀请",
    revoke: "停用",
    signupInvite: "注册邀请",
    signupDescription: "生成一次性邀请码；成员加入时自行设置名称。",
    initialBalance: "🍀 初始余额",
    generateInvite: "生成邀请码",
    invitationHistory: "邀请历史",
    invitationDescription: "复制一次性链接，并查看注册和重置码状态。重置码 7 天有效，新的重置码会让旧码失效。",
    unusedCount: (count: number) => `${count} 个未使用`,
    usedCount: (count: number) => `${count} 个已使用`,
    noInvitations: "暂无邀请",
    joined: (member: string) => `已加入：${member}`,
    resetFor: (member: string) => `重置给 ${member}`,
    invitationFor: (member: string) => `给 ${member}`,
    invitationCredits: (remaining: number, unit: string, member?: string) => `${remaining}${unit}${member ? ` / 已被 ${member} 使用` : ""}`,
    copyInvitationLink: "复制邀请链接",
    cachedTitle: "已缓存视频",
    cachedDescription: "管理员可以删除这些已就绪的缓存文件。",
    loadingCached: "正在加载已缓存视频",
    noCached: "暂无已缓存视频",
    deleteCache: "删除缓存",
    asset: "资源",
    job: "任务",
    cacheFile: "缓存文件",
    range: "分段请求",
    jobsTitle: "最近缓存任务",
    jobsDescription: "用于排查缓存问题的后台状态、资源键和请求 ID。",
    noJobs: "暂无缓存任务记录",
    sourcePage: "源页面",
    breadcrumb: "路径",
    updated: "更新",
    size: "大小",
    deleteFailedJob: "删除失败任务",
    deleteJob: "删除任务",
    errors: {
      enterAdminKey: "请输入管理员密钥。",
      notAdminKey: "这个密钥有效，但不是管理员密钥。",
      creditNonNegative: "代币余额不能小于 0。",
      creditAdjustment: "代币调整必须是非 0 数字。"
    }
  },
  media: {
    title: "媒体",
    type: "类型",
    size: "大小",
    range: "分段请求",
    notChecked: "媒体未检查",
    seekReady: "可快速拖动",
    seekSlow: "拖动可能较慢",
    playbackChecked: "播放已检查",
    notMp4: "不是 MP4",
    unchecked: "未检查"
  },
  cache: {
    status: {
      queued: "排队中",
      fetching: "准备中",
      downloading: "获取中",
      processing: "准备播放",
      uploading: "建立缓存",
      ready: "可播放",
      failed: "失败"
    },
    messages: {
      "Waiting for a cache worker.": "等待开始准备。",
      "Fetching source metadata.": "正在准备片源。",
      "Resolving the media source.": "正在确认可播放版本。",
      "Copying the resolved media into the cache lane.": "正在建立播放缓存。",
      "Publishing the cached asset.": "正在完成播放准备。",
      "Uploading the resolved media into Blob cache.": "正在建立播放缓存。",
      "正在检查播放状态。": "正在检查播放状态。",
      "Ready for playback.": "可以播放。",
      "Failed to cache the resolved media.": "准备失败。"
    },
    notCached: "未缓存",
    checking: "检查中",
    expired: "已过期",
    failedRetry: "准备失败，可以重新准备。",
    errors: {
      blockListInvalid: "缓存写入失败，请重新准备。",
      assetNotReady: "这条影片还没有准备好播放。",
      playbackSizeMissing: "视频大小信息缺失，暂时无法计算播放花费。请重新准备或联系管理员。"
    }
  },
  fallbackErrors: {
    searchFailed: "搜索失败。",
    checkCredit: "无法确认本次花费。",
    creditAction: "扣费操作失败。",
    cacheRequest: "准备请求失败。",
    directDownload: "无法获取下载链接。",
    playbackNotReady: "视频还没有准备好播放。",
    historyStatus: "无法刷新播放历史的缓存状态。",
    cachedTitles: "无法加载已缓存影片。",
    browseTitles: "无法加载浏览影片。",
    memberAccess: "无法加载成员通行码。",
    loginAudit: "无法加载登录记录。",
    movieRequests: "无法加载求片请求。",
    cacheJobs: "无法加载缓存任务。",
    retryCacheJob: "无法重试缓存任务。",
    deleteCacheEntry: "无法删除缓存条目。",
    deleteCachedVideo: "无法删除已缓存视频。",
    updateMovieRequest: "无法更新求片请求。",
    adminKey: "管理员密钥不匹配。",
    generateInvitation: "无法生成邀请码。",
    updateCredits: "无法更新代币。",
    adjustCredits: "无法批量调整成员代币。",
    resetInvitation: "无法创建重置邀请。",
    revokeCode: "无法停用成员通行码。",
    deleteCode: "无法删除成员通行码。",
    spendingRecord: "无法加载消费记录。",
    memberSpendingRecord: "无法加载成员消费记录。",
    submitRequest: "无法提交求片请求。",
    forum: "无法加载讨论。",
    submitForumThread: "无法发布帖子。",
    submitForumReply: "无法发送回复。",
    nowPlaying: "无法加载热映数据。",
    movieSummary: "无法生成剧情简介。",
    updateProfile: "无法更新个人资料。",
    statusRefresh: "状态刷新失败。"
  },
  toast: {
    signupInviteCreated: {
      title: "邀请链接已生成",
      description: "复制链接发给成员即可加入。"
    },
    resetInviteCreated: {
      title: "重置链接已生成",
      description: "复制链接发给成员即可重设通行码。"
    },
    copied: {
      title: "已复制",
      description: "链接已经放到剪贴板。"
    },
    copyFailed: {
      title: "复制失败",
      description: "浏览器没有允许写入剪贴板。"
    },
    requestSubmitted: {
      title: "求片已提交",
      description: "管理员会在请求列表里看到它。"
    },
    profileSaved: {
      title: "设置已保存",
      withPasscode: "显示名和通行码已更新。",
      nameOnly: "显示名已更新。"
    }
  }
} as const;

export const copy = zhCN;

export function cacheStatusLabel(status: CacheStatus) {
  return copy.cache.status[status];
}

export function cacheMessageLabel(message: string) {
  return copy.cache.messages[message as keyof typeof copy.cache.messages] ?? message;
}

export function movieRequestStatusLabel(status: MovieRequestStatus) {
  const labels: Record<MovieRequestStatus, string> = {
    new: "新请求",
    planned: "已计划",
    fulfilled: "已就绪",
    dismissed: "已关闭"
  };
  return labels[status];
}

export function memberStatusLabel(status: ManagedMemberCode["status"]) {
  return status === "active" ? "有效" : "已停用";
}

export function invitationStatusLabel(status: ManagedMemberInvitation["status"]) {
  const labels: Record<ManagedMemberInvitation["status"], string> = {
    unused: "未使用",
    used: "已使用",
    expired: "已过期",
    revoked: "已停用"
  };
  return labels[status] ?? status;
}

export function invitationTypeLabel(type: ManagedMemberInvitation["type"]) {
  return type === "signup" ? "注册" : "重置";
}

export function creditReasonLabel(reason: MemberCreditChargeReason | string) {
  if (reason === "cache_reserved") {
    return "准备";
  }
  if (reason === "playback_stream") {
    return "播放";
  }
  return reason;
}

export function freeReasonLabel(reason?: CreditPreviewFreeReason) {
  switch (reason) {
    case "admin":
      return "管理员免费";
    case "cache_ready":
      return "已准备好";
    case "cache_active":
      return "准备中";
    case "playback_replay":
      return "重看免费";
    default:
      return undefined;
  }
}
