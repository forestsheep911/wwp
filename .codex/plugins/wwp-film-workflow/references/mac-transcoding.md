# macOS 转码兼容与验证

本页对应插件 0.1.121。Windows 继续保留 NVENC 与 `E:\video_made` 默认值；macOS 使用当前机器的能力和明确配置的存储路径。以下验证发生于 2026-10-06，不能替代每部影片的人工 QC。

## 运行环境

`tools/lib/film-media-runtime.mjs` 统一选择 FFmpeg/ffprobe、检查编码器与滤镜。macOS 优先使用已安装的 `/opt/homebrew/opt/ffmpeg-full/bin`，也兼容 Intel Homebrew 的 `/usr/local/opt/ffmpeg-full/bin`。可通过 `WWP_FFMPEG`、`WWP_FFPROBE` 或命令行覆盖；绝对 FFmpeg 路径默认配对同目录 ffprobe。能力检查以实际可执行文件为准。

本机普通 Homebrew FFmpeg 缺少 libass/zscale；已安装的 full 构建支持二者。`--video-encoder auto` 在 Mac 实际试编码后选择 `hevc_videotoolbox`，失败才尝试 `libx265`；Windows 优先试 NVENC。明确指定的编码器不可用则报错。Apple 编码使用独立的 `--vt-quality`（默认 65）或 `--video-bitrate`，不能套用 CQ/CRF 数值。硬件编码禁止静默软件替代。

HDR10/HLG 必须明确选择 `--tone-map-sdr`，Mac 默认采用 zscale/CPU 色调映射，编码仍可用 VideoToolbox。CPU 色调映射可能很慢。Dolby Vision Profile 5 需要已验证的 DV 色彩路径；普通 PQ 映射不能作为替代。本机 Vulkan/libplacebo 设备初始化失败，因此没有验证 Profile 5 转码。

## 存储与操作

运行前检查 `mount`、`df -h`，按 NFS export 识别 NAS，不按 `/Volumes` 后缀猜测卷号。用显式 `--output`、`--temp-dir` 或机器级 `WWP_OUTPUT_ROOT`、`WWP_TEMP_ROOT`。例如确认 USB 挂载后：

```sh
export WWP_OUTPUT_ROOT=/Volumes/Taliban2T/video_made
export WWP_TEMP_ROOT=/Volumes/Taliban2T/wwp-transcode-temp
node .codex/plugins/wwp-film-workflow/scripts/transcode-hevc-mp4.mjs \
  --input /absolute/path/source.mkv --output "$WWP_OUTPUT_ROOT/title.mp4" \
  --subtitle-stream 0 --duration 30
```

这里的输入是占位路径；字幕序号应来自片源探测。Mac 不会创建 `E:\video_made` 这样的本地目录。未挂载的 `/Volumes/<卷>` 会在创建目录前拒绝写入。编码中复查输入、临时区、输出区的存储身份。按设备号判断同卷，完整任务预留工作文件、封装文件和发布副本的空间。`caffeinate` 防止编码期间系统空闲休眠，不能保障拔盘或网络断开。

输出已有文件时拒绝覆盖。任务拥有专用 `.wwp-encode-*` 目录、状态文件、日志与独占输出锁。发布到目标卷的临时副本须通过大小和 SHA-256 校验，再取得成品名称；失败保留工作文件。中断时转发信号，子进程不退出则升级终止。取样任务有时限，任何任务连续 3 分钟没有推进的媒体时间都会停止，避免 PGS 无字幕区间无限等待。

检查 `state.json` 和 `ffmpeg.log` 后，用原命令加 `--resume` 复用完整视频/音频/封装检查点；会重查时长与解码。没有完整检查点时使用 `--restart-work`，只重建该任务目录。`--recover-lock` 仅允许恢复同机器已退出进程的锁。改动输入、计划、工具版本或存储身份后不能复用原检查点。两项封装工具不复用中间阶段，失败后检查日志并加 `--restart-work` 重跑；锁恢复限制相同。分辨率/字体等变更应选择新输出路径。

## 字幕、声音与 QC

外部 ASS/SRT 复制到任务目录内的安全相对文件名，解决中文、空格、单引号、括号等路径的滤镜转义问题。嵌入 ASS 保留样式并提取字体附件；Mac 为无法供应中文的样式字体替换为 STHeiti，记录替换，保留时间、颜色、位置和尺寸。复杂特效或依赖特殊字形的字幕仍须人工检查；可用 `--fonts-dir`、`--subtitle-font` 控制。GBK 等字幕须明确 `--subtitle-charenc`。缺字诊断会阻止成功出片。

音频输出 AAC；多声道保留明确 channel layout。封装检查 HEVC hvc1、预期音视频流与时长，执行短段严格解码。编码器数值测试不能证明整片音画同步、音量、语种、字幕内容和色彩正确。

跨平台 QC 工具替代 Windows PowerShell 依赖：

```sh
node .codex/plugins/wwp-film-workflow/scripts/make-qc-contact-sheet.mjs \
  --input /absolute/path/title.mp4 --output-dir /absolute/path/qc
```

它生成均匀分布的截图、contact-sheet.png、探测与解码证据 qc.json；可用 `--wait-pid` 有界等待转码。只表示 `qc_ready`，不自动授予 `qc_passed`，不发布 Notion。

## 可复现验证与限制

```sh
node --test tools/lib/film-media-runtime.test.mjs tools/lib/film-encode-job.test.mjs tools/lib/film-ass-fonts.test.mjs \
  .codex/plugins/wwp-film-workflow/scripts/*.test.mjs \
  tools/lib/film-ledger-*.test.mjs tools/film-ledger.test.mjs \
  tools/film-cleanup-candidates.test.mjs tools/film-relocate-finished-outputs.test.mjs \
  tools/film-output-ledger-audit.test.mjs
WWP_MEDIA_INTEGRATION=1 node --test \
  .codex/plugins/wwp-film-workflow/scripts/transcode-integration.test.mjs
npm run typecheck
```

真实 FFmpeg 矩阵覆盖 Apple HEVC、CPU 编码、HDR10、ASS/附件字体、中文特殊路径、GBK、PGS 提前结束、5.1 AAC、覆盖拒绝、封装失败后的断点恢复与 QC。当前回归命令 360 项通过，1 项实机集成默认跳过；显式启用的 FFmpeg 矩阵另有 13 项全部通过。全项目 TypeScript 检查通过。单元验证包括锁竞争、计划变更、哈希发布、强制超时与不推进的进度信息。Windows 路径兼容有回归测试；本轮没有 Windows/NVIDIA 实机验证。

真实 NAS Blu-ray M2TS 的 SDR 开头 12 秒，通过 DTS→AAC、VideoToolbox、1280×720、hvc1 与解码/QC；4K HDR10 开头 8 秒也通过 CPU→BT.709 映射、PCM→AAC 与硬件编码。检查缩略图未见明显绿色/紫色异常，但片头不能代替真实人脸与暗部色彩验收。中文字体测试截图可读，无方块字。音频变体封装与 hev1→hvc1 无损修复也在真实样本运行成功。真实片源中部跳转也出现 DTS 包/HEVC 参考帧错误，严格检查拒绝这些样本；尚不能归因为片源损坏，需要单独验证 seek、关键帧和具体片源。PGS 无事件区间可能等待，须选择有对白字幕的区间且遵守超时。测试样本保存在 `/Volumes/Taliban2T/wwp-tmp/mac-compat-validation-20261006`，保留失败工作目录，不修改生产台账或删除原片。

浏览器/QuickTime 实际播放、长片连续任务、外接卷真实断连和 Windows GPU 运行仍需独立验收；短样本通过不能代表这些项目已验证。


## 0.1.121 色彩与开销优化

- 保留普通路径的 Hable 和 libplacebo 路径的 Mobius 算法。HDR 输出明确采用 BT.709 primaries/transfer/matrix、limited range；封装后逐项检查，缺失或不一致则拒绝发布。源色彩标记、映射算法、交付位深和抖动设置写入任务计划及结果 JSON，便于跨机器对照。
- HDR 的浮点/10-bit 到 8-bit 转换使用 zscale ordered dithering，减轻量化色带风险。此项不恢复 8-bit 无法承载的 HDR 信息，也不能替代画面验收。
- CPU 路径缩放为偶数尺寸，映射后只添加一次黑边；不对黑边重复进行昂贵的色彩处理。宽银幕 HDR→SDR 的 CPU 编码回归验证了画布尺寸、BT.709 标记和接近 Y=16 的有限范围黑边。
- 单任务复用一次源 ffprobe 的 streams/format 数据，覆盖尺寸、帧率、起始时间、音轨、字幕及字体附件；工作文件和交付文件仍独立探测。集成测试通过包装实际 ffprobe 验证读源调用只有一次，成品探测仍存在。缓存不跨进程/任务复用。
- 保留 FFmpeg 自动滤镜线程调度。本机同一 4K HDR 短样本 75 帧的隔离测试，自动线程约 0.46 秒，强制 1 线程约 2.37 秒，4 线程约 0.78 秒；这些结果不能外推到 Windows/CUDA。
- 修改前后滤镜各跑三次，耗时分别约 0.46–0.51 秒与 0.48 秒；改用 5 秒处可见片头画面进行编码前 RGB 对照，平均绝对差约 0.38/255，PSNR 约 50.3 dB；这是映射结果彼此接近的证据，不是对 HDR 原片还原准确度的评分。最初抽到的黑场不作为色彩对照证据。未观察到明显滤镜提速，也未稳定复现前次真实任务的持续慢速，不能把它直接归因于 CPU tone mapping。实际吞吐仍受解码、存储、封装、字幕和系统负载影响。

对照证据为外部测试目录的 `hdr-thread-benchmark.json`、`hdr-color-benchmark.json`、`hdr-color-before.png`、`hdr-color-after.png`。优化后的真实 NAS HDR10 8 秒样本为 `abetter-hdr-color-optimized.mp4`，已通过成品色彩标记、时长和解码检查。这是片头样本，不代表复杂人脸、暗部或整片均已验收。
