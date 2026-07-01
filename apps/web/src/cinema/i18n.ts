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
    passcodeRule: "最多 12 个半角字符，至少包含 1 个字母和 1 个数字。",
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
    admin: "管理台",
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
    table: {
      title: "片名",
      metadata: "信息",
      people: "类型/人物",
      specs: "规格"
    },
    browseViews: {
      recent: { label: "最近更新", detail: "按目录更新时间排列" },
      newGood: { label: "近期佳片", detail: "新片优先，兼顾评分" },
      popular: { label: "热门佳片", detail: "播放与评分综合排序" },
      topRated: { label: "评价最高", detail: "优先展示评分条目" },
      mostWatched: { label: "观看最高", detail: "按家庭播放记录排序" },
      doubanRank: { label: "豆瓣排名", detail: "按豆瓣评分优先排列" },
      imdbRank: { label: "IMDb 排名", detail: "按 IMDb 评分优先排列" },
      rottenRank: { label: "烂番茄排名", detail: "按烂番茄评分优先排列" }
    },
    loadMore: "加载更多",
    loadedAll: (count: number) => `已显示 ${count}`,
    continueLoading: "继续加载更多影片",
    emptyBrowse: "暂无可浏览影片",
    noVariants: "无规格",
    viewDetails: "查看详细信息",
    viewAllVariants: "查看全部规格",
    directDownload: "直接下载",
    moreVariants: (count: number) => `还有 ${count} 个规格`,
    variantCount: (count: number) => `${count} 个规格`,
    playableVariantCount: (count: number) => `${count} 个可播放`,
    director: (name: string) => `导演 ${name}`,
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
    badge: "家庭规则",
    intro: "WWP 是给家里人和朋友临时看片用的。最大不同是：很多片子不是天然在线流媒体，需要先准备成可在线播放的缓存；准备和观看都会消耗 🍀 代币。",
    rules: [
      {
        title: "这是家里人和朋友的小片库",
        body: "它不是公开视频网站，也不追求所有内容都随点随播。片源、缓存和播放流量都放在家庭账户里，所以需要一点规则来避免浪费。"
      },
      {
        title: "第一次看之前要先准备",
        body: "没有缓存过的片子，点规格后会进入准备队列。系统会去确认片源、搬到播放缓存、检查是否适合在线播放；准备完成后才会打开播放器。"
      },
      {
        title: "准备和观看都会花代币",
        body: "准备一部片会花准备代币；真正开始观看时，还会按播放规则花观看代币。代币是为了让大家少点误触、少重复准备大文件。"
      },
      {
        title: "缓存命中会更快",
        body: "如果别人已经准备过，或这部片还在缓存期内，你可以直接播放。短时间内重看同一部片通常不会重复收取观看代币。"
      },
      {
        title: "找不到片可以请求",
        body: "搜索不到、规格不对、或者想补片，可以在账号菜单里提交求片请求。管理员看到后会决定是否补进片库。"
      },
      {
        title: "账号和代币别外传",
        body: "这个站只给熟人使用。通行码、播放链接和缓存内容都不要公开传播；如果代币不够，找管理员补。"
      }
    ],
    flowTitle: "简单流程",
    flowBody: "先在推荐、电影、电视、动画里挑片；选择一个规格后，如果还没准备好，就等它完成缓存；准备完成后点播放在线观看。看过的片子会进播放历史，已缓存的片子可以从账号菜单里的缓存任务找到。"
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
      playbackCharge: (credits: string, hours: number) => `这个视频已经准备好，开始播放需要花费 ${credits}。首次点击后，${hours} 小时内重看同一视频免费。`
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
      assetNotReady: "这条影片还没有准备好播放。"
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
