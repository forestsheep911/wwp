# URL、导航与状态恢复审计（2026-09-22）

## 统一规则

本站公开身份与内部来源分离。作品 /works/<名称>-w_<编号>、人物 /people/<名称>-p_<编号>、资源 /watch/v_<编号>。编号来自持久化 public-identities.json；名称变化不影响定位。旧作品、人物、查询参数入口继续解析。作品归并仅使用现有 catalog 和明确来源/外部 ID 关系，不按标题合并。

URL 负责内容定位；history entryKey 负责返回现场；带账号作用域的 sessionStorage 负责本标签页缓存、滚动锚点、草稿和播放进度。长期偏好仍独立保存。缓存失败降级到内存，不阻断导航。来源路径在 history.state 中，不附在作品地址上。

## 逐项审计与实施对应

| 入口/内容 | 规范地址 | 可恢复状态 | 返回/权限/失败规则 |
|---|---|---|---|
| 片库、频道、榜单 | /?channel=…&view=… | 类型、年代、评分、题材、可播放筛选；已加载范围、条目锚点 | 内容链接打开详情；回退恢复同一条历史记录 |
| 随机推荐 | /?view=lucky&seed=… | 同种子在同一索引内容下获得同批结果 | 服务端与前端均使用种子；内容下架可能改变结果 |
| 作品详情 | /works/<名称>-w_<编号> | 稳定作品身份 | 站内来源优先，直达退片库；加载失败有重试，不显示上一部作品 |
| 人物目录/详情 | /people?q=…、/people/<名称>-p_<编号> | 目录查询、已加载人物；人物身份 | 目录/作品/图谱链接使用相同编号；失败可重试 |
| 关系图 | 作品或人物地址后加 /graph | 中心、depth、limit、branches；会话内缩放、平移、列表查询 | 每次换中心一条历史；关闭退进入图谱的详情；直达退当前中心详情 |
| 全站搜索工具 | 日常不改变页面地址 | 输入草稿、已提交词、结果、类型、选中项、结果滚动 | Ctrl/Command+K 呼出；Esc 关闭恢复焦点；导航时关闭并保留会话 |
| 搜索分享页 | /search?q=…&scope=… | 查询与筛选在 URL，其余在会话 | 独立页面复用搜索组件；复制链接以已提交查询为准 |
| 播放 | /watch/v_<编号> | 资源、会话内进度；既有线路偏好 | 刷新先恢复选择界面，不自动申请播放/准备；授权后才继续 |
| 收藏、历史、缓存、任务 | /favorites、/history、/cached、/tasks | 列表滚动；收藏已展开数量 | 继续使用现有账号与业务权限；收藏记录内的旧 assetKey 不迁移 |
| 发现、热映、统计、帮助 | /watchlist、/now-playing、/statistics、/help | 页面与滚动 | 内容动作维持现有行为 |
| 论坛 | /forum、/forum/<threadId> | 选中帖子；发帖和回复草稿按账号/目标隔离 | URL 指定帖子优先，不自动换成第一篇；现有服务端权限 |
| 我的、通知、求片、用量 | /profile、/profile/notices、/profile/requests、/profile/usage | 内容子页；求片草稿 | 子页复用现有弹窗，可直达刷新；关闭回到站内来源 |
| 管理 | /admin/<section> | cached/jobs/passes/invites/requests/notices/security/oss-poc | 保留管理员鉴权；非法子栏目显示不存在 |
| 设置、说明、预览、确认框 | 不增加独立地址 | 主题、视图等偏好长期保存；悬停/确认临时保存 | 密码、邀请码、扣费确认、下载签名不保存到会话或 URL |
| 无效/失效路径 | 保留请求地址 | 不适用 | 未知页面显示不存在；失效资源显示错误，不静默退首页 |

## 实现边界和接口

- `cinema/routing.ts` 统一解析/生成规范 URL，`cinema/navigation.ts` 统一写入浏览历史、来源、滚动锚点和恢复。
- API 返回可选 `publicId`、`canonicalPath`、`playbackPath`。`GET /api/public-routes` 返回已发布实体映射；`GET /api/public-resolve/{work|person|video}/<id-or-legacy-key>` 解析身份。库详情和人物接口同时接收公开 ID。接口沿用登录鉴权。
- `session-state.ts` 有版本、12 小时最大会话缓存寿命、80 项数量上限与单项大小限制；搜索结果 10 分钟内直接复用，过期保留现有结果并刷新。关闭浏览器后是否恢复 sessionStorage 受浏览器“恢复上次会话”设置影响，不提供跨设备同步。
- 图谱渲染坐标可能随布局算法改变；恢复相机位置和探索范围，不把完整节点物理布局写入链接。
- 浏览列表的内容可随发布/下架变化，恢复锚点优先于固定像素。新标签页按 URL 加载，不从另一个页面来源推断目标。

## 迁移与回滚

家庭站已配置的持久数据目录中保存 `public-identities.json`，更新前生成 `.bak`，写入采用临时文件加原子替换。注册表不能随搜索索引清理，也不能在回滚前端时删除。

先停站或确认服务未运行，再执行 `node --import tsx tools/migrate-public-identities.mjs` 只读检查；无冲突后加 `--apply`。输入仅为本地影视/人物索引，不请求 Notion。重复运行应保持相同编号。若冲突，报告中包含冲突别名与来源键，禁止自动按标题处理。

先迁移身份和服务端，再部署新前端；旧前端仍能使用内部 ID 接口。回滚界面不回滚身份注册表。静态服务对新页面路径返回 index.html，对不存在的 API/资源不返回 HTML。

## 验证入口

- `node --import tsx --test apps/web/test/*.test.ts apps/web/src/cinema/*.test.ts apps/api/src/public-identities.test.ts apps/api/src/static-web.test.ts`
- `npm run typecheck` 和 `npm run home:build`
- Vite 5293 上运行 `python apps/web/test/navigation-review.py`：真实浏览器、模拟 API、桌面/手机搜索往返、刷新、图谱前进后退、分享搜索、无效页面；断言没有写入或播放申请。
- 生产验证另外检查健康、实际构建指纹、深链接 HTTP 回退与真实 API 身份解析。模拟 API 测试不代表已验证真实账号全部业务。


## 本次验证记录

- 本地索引迁移完成：876 作品、957 人物、6,574 资源，8,407 条公开身份，无冲突。
- 自动化行为/回归测试 160 项通过；web、API、worker 类型检查通过。
- 完整应用浏览器测试覆盖 1366、390、360 像素，增加人物目录返回、帖子/回复草稿刷新、通知直达刷新、播放页不自动申请、图谱目标加载失败后重试，零页面错误、零业务写请求。
- 真实家庭站服务在 43187 运行；真实登录、身份解析、作品/人物深链接刷新、旧作品地址跳转、搜索往返和图谱刷新通过，未申请播放或准备。报告保存在 `.local-data/navigation-review/live-report.json`，截图在同目录。
- 公网真实浏览器验收通过：真实登录、8,407 条身份解析、作品/人物深链接刷新、旧地址跳转、搜索往返、图谱刷新，零页面错误、零播放/准备请求。报告为 `.local-data/navigation-review/live-public-report.json`；公开身份映射已启用 gzip。
- 部署经现有 `run-home-site-task.ps1` 启动，完成隔离验证后已恢复常规元数据同步。仅进程级限制索引/资源同步并发为 1；未修改 `.env` 或计划任务配置。

- 最终部署主资源为 `/assets/index-CXhqKIlX.js`；公网首页返回 200 且指纹一致。最终本地真实浏览器复验通过。
