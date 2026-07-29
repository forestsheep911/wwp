# Notion Source Upload Notes

## Current Target

- Notion page: `38f20ac1-2f0a-80b4-ae56-ca6cb5f51383`
- Page title: `铁拳教育 第 1 季`
- Source directory: `I:\MAKE\Teach.You.a.Lesson.S01.2026.Complete.1080p.Netflix.WEB-DL.AVC.DDP.5.1.Atmos-DBTV`
- Source files: 10 MKV files, `26,620,709,161` bytes.

The Notion page structure has already been normalized to match the standard TV layout:

```text
callout
  -> 铁拳教育 第 1 季 普通话 繁简英 26.6GB
divider
基地
  -> 片源
    -> 26.6GB
```

The main page property `影别` has been changed from `Movie` to `TV Series`.

## Local Artifacts

The current archive output is:

```text
.local-data/source-archives/Teach.You.a.Lesson.S01.2026.1080p.Netflix.WEB-DL.AVC.DDP.5.1.Atmos-DBTV/
```

The latest successful archive pass used:

```powershell
node tools\notion-upload-series-source.mjs --package
```

With the current script default `-v700m`, 7-Zip produced 37 parts totaling `26,620,709,575` bytes. The first part is:

```text
Teach.You.a.Lesson.S01.2026.1080p.Netflix.WEB-DL.AVC.DDP.5.1.Atmos-DBTV.7z.001
734,003,200 bytes
```

There is currently no active upload manifest:

```text
.local-data/notion-source-upload-38f20ac12f0a80b4ae56ca6cb5f51383.json
```

If this file appears during a failed upload, inspect `sentParts`, `fileUploadId`, and `partCount` before retrying.

## Script

Main helper:

```text
tools/notion-upload-series-source.mjs
```

Important behavior:

- Packages with `7z a -t7z -mx=0`, because video files should be stored rather than compressed.
- Defaults to `700m` split volumes after testing larger sizes.
- Uploads through Notion `fileUploads` multipart API.
- Converts local names like `.7z.001` to an API-safe upload filename like `.7z.part-001.7z`, because Notion File Upload API rejects `.001` as the final extension.
- Keeps the visible Notion file block name as the original `.7z.001`.
- Uses a 10-minute Notion client timeout; the default 60/120 seconds was too low for 20MiB parts on the tested network.
- Supports limiting upload count:

```powershell
node tools\notion-upload-series-source.mjs --apply --upload --max-upload-files 1
```

## Findings

Notion File Upload API constraints observed here:

- Multipart uploads expire about 1 hour after creation.
- A large upload must finish all parts and `complete` before `expiry_time`.
- `*.7z.001` filenames are rejected by the File Upload API because the final extension is unsupported.
- The page UI can contain `.7z.001` file names from manual upload, but the API create step still validates the uploaded filename.
- `upload_url` and `complete_url` point to `api.notion.com`; there was no S3-style direct upload URL to bypass the API path.

Network observations:

- `5000m` split produced 5.24GB parts, too close to or over the practical 5GB single-file ceiling.
- `4500m` split produced 4.72GB parts, but the observed upload speed could not finish within the 1-hour Notion upload expiry window.
- `700m` split should be a better test size: 35 parts at 20MiB per full part, with a realistic chance to complete if the network path is healthy.
- In the poor network run, 20MiB parts took roughly 50 seconds to several minutes, which is not enough for 700MiB within 1 hour.

### 2026-07-28 Route Probe

- `tools/notion-upload-route-probe.mjs` reproduced the slow path at about
  `0.15 MiB/s` per 20MiB part.
- The slow API target had been resolved to `208.103.161.1` inside Node before
  Clash saw it. Clash therefore had no `api.notion.com` host metadata and sent
  the connection through `Match -> 兜底代理 -> 规则代理 -> 自建自动`.
- Disabling the DNS override preserved `api.notion.com`; Clash then selected
  `Notion -> 国内直连 -> DIRECT`.
- A direct 20MiB part completed in `3.48s` (`5.75 MiB/s`). A seven-part
  140MiB run measured `3.31-9.41 MiB/s`, averaging about `5.9 MiB/s`.
- Production upload helpers now keep hostname routing by default. Their
  `--resolve-ip` option is an explicit API-connectivity fallback, not the
  normal large-file path.

## Resume Plan

When the network is healthy, retry only the first 700MiB part:

```powershell
node tools\notion-upload-series-source.mjs --apply --upload --max-upload-files 1
```

Monitor logs:

```powershell
Get-Content .local-data\notion-upload-001.stdout.log -Tail 40
Get-Content .local-data\notion-upload-001.stderr.log -Tail 40
```

If it completes, verify the Notion tree has one file block under:

```text
铁拳教育 第 1 季 -> 基地 -> 片源 -> 26.6GB
```

Then continue with more parts by raising `--max-upload-files`, or omit it to upload all remaining parts.

If the first 700MiB part still cannot complete inside 1 hour, reduce the split size before repackaging:

```powershell
node tools\notion-upload-series-source.mjs --volume-size 100m --package
node tools\notion-upload-series-source.mjs --apply --upload --max-upload-files 1 --volume-size 100m
```

Use smaller split volumes only if needed, because they increase the number of Notion file blocks substantially.
