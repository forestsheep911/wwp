# WWP 影视制作本地台账与定向 Notion 对账设计

## 1. 背景

现有 `watch-notion-manual-uploads.mjs` 会周期性扫描最近页面，历史版本还会扫描整个影视库。影视库已经超过 1200 个作品页，Notion API 无法承受这种轮询方式，最终表现为频繁限流、扫描长时间占用、结果不完整，以及无法可靠区分“没有新上传”和“扫描失败”。

与此同时，本地制作过程已经产生大量 JSON、Markdown、ffprobe、QC 和 handoff 文件，但这些记录没有统一索引。代理需要反复搜索文件和 Notion，容易重复压制、重复建页或误判规格状态。

本设计以 SQLite 作为本地制作台账。Notion 不再承担“搜索全部待办”的职责，只作为少量已知目标的发布端和最终事实来源。

## 2. 目标

1. 只在当前制作观察范围内处理少量作品，默认每批 3–5 个。
2. 所有片源、规格、压制、QC、Notion 目标和 Media Assets 状态进入本地 SQLite。
3. 本地 QC 通过后停止重复压制，但继续保留在发布待办中。
4. 只有达到“网站可同步”状态后，作品规格才最终退出观察范围。
5. 手工上传检测只访问台账中已登记的 Notion page ID，不做全库扫描。
6. 429、超时和网络错误不得被解释为“没有上传”。
7. 迁移现有 `.local-data` 记录时保留来源证据，不覆盖较强的人类判断。

## 3. 非目标

- 不建立通用媒体资产管理平台。
- 不实时镜像整个 Notion 影视库。
- 不自动发现台账之外、任意旧页面中的未知手工上传。
- 不在 v1 中删除现有 JSON、Markdown、probe 或 QC 文件；SQLite 只负责索引和状态。
- 不改变现有编码器、Notion 上传器和 Media Assets writer 的核心实现。

## 4. 核心原则

### 4.1 本地台账是工作索引

SQLite 保存“下一步该做什么”。Notion 保存最终页面和媒体事实。代理先查询 SQLite，再按明确 page ID 定向访问 Notion。

### 4.2 制作完成与最终退出分离

- `qc_passed`：本地成品通过探测与人工/图像 QC，不再重复压制。
- `sync_ready`：Notion 上传、页面结构、Media Assets 和回读全部通过，网站可同步。

`qc_passed` 只退出压制候选；`sync_ready` 才退出全部观察范围。

### 4.3 失败是状态，不是空结果

API 429、请求超时、颜色错误、字幕错误、音轨身份未确认等都要保存为明确状态和原因。失败记录通过 `next_review_at` 控制重试，不在每轮重复处理。

## 5. 状态模型

状态拆成两个正交维度，避免一个枚举同时表达压制和发布。

### 5.1 制作状态 `production_state`

| 状态 | 含义 |
|---|---|
| `discovered` | 已发现片源，尚未评估 |
| `evaluated` | 已识别作品并完成价值/质量评估 |
| `selected` | 已进入当前制作范围 |
| `encoding` | 正在压制 |
| `qc_failed` | 成品不合格，可记录是否允许重试 |
| `deferred` | 暂不制作，等待新片源、字幕或用户条件 |
| `qc_passed` | 本地成品通过 QC，不再进入压制候选 |
| `rejected` | 明确不制作，除非人工重新打开 |

### 5.2 发布状态 `publication_state`

| 状态 | 含义 |
|---|---|
| `not_ready` | 本地成品尚未通过 QC |
| `structure_pending` | 需要创建或修正作品/规格/episode 页面 |
| `upload_pending` | 页面结构已准备，等待上传 |
| `upload_seen` | 目标页面已看到媒体块 |
| `assets_pending` | 等待写入或修复 Media Assets |
| `verification_pending` | 等待页面和 Media Assets 回读 |
| `sync_ready` | 网站可同步，最终退出观察范围 |

### 5.3 最终退出条件

一个规格只有同时满足以下条件，才能进入 `sync_ready`：

1. `production_state = qc_passed`
2. 已记录稳定的 Notion work/spec/episode page ID
3. 媒体块位于正确的规格或 episode 页面
4. Media Assets 行存在且关键字段完整
5. 页面结构和 Media Assets 回读成功
6. 没有待处理的 `Needs Review` 冲突；`Hide from Website` 是否解除仍遵循现有人工门禁规则

## 6. SQLite 数据模型

数据库位置：`.local-data/wwp-film-workflow.sqlite`。该文件属于运行数据，不进入 Git。

Node.js 使用内置 `node:sqlite`，避免新增本地原生依赖。数据库启用 WAL、foreign keys 和合理的 busy timeout。

### 6.1 `input_roots`

记录任意用户指定的输入目录，不固化 `I:\MAKE\queue`。

| 字段 | 用途 |
|---|---|
| `id` | 主键 |
| `path` | 规范化绝对路径，唯一 |
| `enabled` | 是否参与本地发现 |
| `last_scan_at` | 最近扫描时间 |
| `scan_cursor` | 可选的增量扫描状态 |

### 6.2 `works`

| 字段 | 用途 |
|---|---|
| `id` | 本地稳定 ID |
| `canonical_title` | 规范作品名 |
| `year` | 年份 |
| `work_type` | movie/series/season |
| `notion_work_page_id` | 已知 Notion 作品页 |
| `priority_score` | 制作优先级 |
| `scope_state` | candidate/active/deferred/complete |
| `next_review_at` | 延后项目重新进入观察范围的时间 |

作品级 `complete` 表示当前登记的目标规格均已 `sync_ready`；新片源或新规格仍可重新打开作品。

### 6.3 `sources`

| 字段 | 用途 |
|---|---|
| `id` | 主键 |
| `work_id` | 所属作品 |
| `input_root_id` | 来源目录 |
| `path` | 当前绝对路径 |
| `fingerprint` | 大小、mtime 和可选快速 hash |
| `source_kind` | file/folder/bdmv/iso/remux |
| `probe_path` | ffprobe/BDInfo 证据文件 |
| `quality_state` | unknown/usable/problematic/rejected |
| `subtitle_evidence` | 中文字幕证据摘要 |
| `audio_evidence` | 国配/台配/粤配/原声证据摘要 |
| `color_risk` | SDR/HDR/DV/unknown |

同一 fingerprint 不重复入库。文件改名时可通过 fingerprint 关联旧记录。

### 6.4 `variants`

每个最终可播放规格一行。

| 字段 | 用途 |
|---|---|
| `id` | 主键 |
| `work_id` | 所属作品 |
| `source_id` | 使用的片源 |
| `spec_key` | 规范化规格键，唯一 |
| `display_title` | Notion 规格标题 |
| `audio_variant` | original/mainland-mandarin/taiwan-mandarin/cantonese/commentary |
| `subtitle_variant` | none/chs/cht/chs-eng/cht-eng 等 |
| `cut_variant` | theatrical/director/extended 等 |
| `target_size_bytes` | 计划大小 |
| `output_path` | 最终本地文件 |
| `output_size_bytes` | 实际字节数 |
| `probe_path` | 最终 ffprobe 证据 |
| `qc_artifact_path` | QC 图或报告 |
| `production_state` | 制作状态 |
| `publication_state` | 发布状态 |
| `failure_code` | 结构化失败原因 |
| `failure_detail` | 人类可读说明 |
| `next_review_at` | 可重试时间 |

`spec_key` 不依赖文件名，至少由作品、音轨、字幕、剪辑版和输出档位组成。实际规格标题中的大小来自 `output_size_bytes`，不信任旧文件名。

### 6.5 `notion_targets`

| 字段 | 用途 |
|---|---|
| `variant_id` | 一对一关联规格 |
| `work_page_id` | 作品页 |
| `spec_page_id` | 电影规格页或剧集规格页 |
| `episode_page_id` | 剧集分集页，可空 |
| `expected_filename` | 预期手工上传文件名 |
| `media_block_id` | 已发现媒体块 |
| `media_asset_page_id` | Media Assets 行 |
| `structure_verified_at` | 结构回读时间 |
| `media_verified_at` | 媒体块回读时间 |
| `assets_verified_at` | Media Assets 回读时间 |
| `next_check_at` | 下一次定向检查时间 |
| `attempt_count` | 连续失败次数 |
| `last_error_code` | 429/timeout/not_found 等 |

### 6.6 `events`

追加式审计记录，不参与核心查询。

| 字段 | 用途 |
|---|---|
| `id` | 主键 |
| `entity_type` / `entity_id` | work/source/variant/target |
| `event_type` | discovered/selected/encode_started/qc_failed/upload_seen 等 |
| `payload_json` | 证据和变更摘要 |
| `created_at` | 时间 |

## 7. 工作流

### 7.1 本地片源发现

1. 输入目录 watcher 只维护本地 SQLite，不访问 Notion。
2. 发现新路径或 fingerprint 变化时写入 `sources` 和事件。
3. 已存在且未变化的片源不重复评估。
4. 每轮从 `candidate` 中按优先级取最多 5 个进入分析。
5. 分析后进入 `selected`、`deferred` 或 `rejected`。

### 7.2 制作批次

制作查询只返回：

- `production_state` 为 `evaluated`、`selected` 或允许重试的 `qc_failed`
- `next_review_at` 为空或已到期
- 不存在相同 `spec_key` 的 `qc_passed` 规格

单轮默认最多 3 个长任务或 5 个轻任务。编码开始、结束、probe、QC 和失败都即时写台账。

### 7.3 发布待办

本地 QC 通过后：

1. `production_state = qc_passed`
2. 不再出现在压制队列
3. `publication_state` 进入 `structure_pending` 或 `upload_pending`
4. 写入明确的 Notion page ID 和预期文件名

### 7.4 手工上传检查

后台不再运行全库 Notion watcher。定向对账器只查询：

```text
publication_state != sync_ready
AND next_check_at <= now
AND notion target page ID 已知
ORDER BY priority, next_check_at
LIMIT 3
```

每个规格只读取其已知 spec/episode page。发现媒体后推进到 `upload_seen`；未发现则更新 `next_check_at`。用户明确说“刚上传了一批”时，可以临时提高本轮 limit，但仍只检查已登记目标。

未知手工上传不自动全库发现。用户提供作品名或页面后，通过一次性命令登记目标，再进入正常对账流程。

### 7.5 Media Assets 与最终回读

检测到正确媒体块后：

1. 用本地最终 probe/manifest 写 Media Assets
2. 回读目标页面、媒体块和 Media Assets
3. 验证关键字段、关系和规格标题
4. 成功后设置 `publication_state = sync_ready`
5. 规格退出全部观察范围

## 8. Notion 请求预算与退避

- 默认每轮最多处理 3 个目标。
- 不查询整个影视数据库，不按 `last_edited_time` 猜上传范围。
- 每个目标维护独立 `next_check_at` 和 `attempt_count`。
- 429 触发全局 circuit breaker，例如 60 分钟内禁止任何自动 Notion 请求。
- 超时和 5xx 使用指数退避；`not_found` 进入人工复核，不无限重试。
- 成功检查的目标按照状态决定下一次时间：上传等待可较密，已完成目标永不再查。
- 用户命令可以绕过普通调度顺序，但不能绕过全局 429 circuit breaker，除非显式使用人工强制参数。

## 9. 命令边界

v1 提供一个统一入口，例如 `tools/film-ledger.mjs`：

```text
init
discover --root <path>
next --stage production --limit 5
next --stage publication --limit 3
show --work <title-or-id>
record-qc --variant <id> --pass|--fail
register-target --variant <id> --work-page <id> --spec-page <id>
reconcile-notion --limit 3
status
migrate-local-data
```

现有编码、上传和 Media Assets 脚本继续工作，但在开始和结束时调用台账入口更新状态。

## 10. 迁移策略

1. 初始化数据库并登记当前输入目录。
2. 导入现有 queue watcher state，建立 sources fingerprint 基线。
3. 读取 `.local-data` 中可识别的 handoff、probe、QC 和 organizer 报告。
4. 只自动导入有明确路径/page ID/状态证据的记录。
5. 相互矛盾的记录进入 `needs_review`，不自动选择较新的文件名作为真相。
6. 人类已确认的音轨、颜色和 QC 结论优先于旧文件名和 `Chinese/zho` 标签。
7. 迁移完成后停用 `watch-notion-manual-uploads.mjs`；两个本地输入目录 watcher 改为写 SQLite。

## 11. 故障处理

- 数据库写入使用事务；一次状态推进和事件写入必须原子完成。
- 重复命令必须幂等，不能生成重复 work/source/variant/target。
- 本地文件消失时保留记录并标记 `local_file_missing`，不删除 Notion 证据。
- QC 失败保留失败原因，例如 `dv_green_cast`、`subtitle_sync`、`wrong_audio_variant`。
- Notion 失败不回退已通过的本地制作状态。
- 数据库损坏时可从事件、现有 JSON/Markdown 和 Notion 定向回读重建；定期生成 SQLite 备份。

## 12. 测试策略

### 12.1 单元测试

- 状态转换合法性
- `sync_ready` 最终门槛
- fingerprint 去重和路径改名
- 规格键与实际字节大小标题
- 国配/台配/粤配证据优先级
- per-target 和全局退避计算
- 每轮 limit 和排序

### 12.2 集成测试

- 临时 SQLite 数据库完成 discover → QC → upload → assets → sync_ready 全流程
- 重复执行同一命令不产生重复记录
- 模拟 429 后不再发出后续自动请求
- 手工上传只读取登记过的 page ID
- 电影和电视剧 episode 两种页面结构

### 12.3 迁移测试

- 导入代表性的 handoff/probe/QC/organizer 文件
- 冲突音轨和错误大小不得自动变成 `sync_ready`
- 已确认不合格的 DV 偏绿成品进入 `qc_failed` 或 `deferred`

## 13. 验收条件

1. 后台没有任何全库 Notion 扫描。
2. 输入目录新增文件能进入 SQLite，未变化文件不会重复评估。
3. 单轮制作候选默认不超过 5 个。
4. QC 通过的规格不会再次进入压制队列。
5. 发布待办只访问已登记 page ID，默认单轮不超过 3 个。
6. 429 后全局 circuit breaker 生效，失败不被写成“无上传”。
7. 只有完成上传、结构、Media Assets 和回读的规格进入 `sync_ready`。
8. `sync_ready` 规格不再被任何 watcher 或普通待办查询选中。
9. 状态查询能解释每个作品为什么正在处理、等待、失败或已完成。

## 14. 已确认决策

- SQLite 是本地制作过程的权威工作索引。
- 本地 QC 通过和最终网站可同步是两个独立阶段。
- 最终退出条件是 `sync_ready`，不是单纯压制完成。
- 不再接受全库 Notion watcher。
- 每轮只处理少量、台账内的明确目标。
- 完成记录永久保留用于去重和审计，但默认查询排除。
