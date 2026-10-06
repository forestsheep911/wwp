import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync, spawn } from 'node:child_process';
import test from 'node:test';
import { resolveMediaTools, capture } from '../../../../tools/lib/film-media-runtime.mjs';
import { sampleTimes } from './make-qc-contact-sheet.mjs';

const enabled = process.env.WWP_MEDIA_INTEGRATION === '1';
const script = path.join(import.meta.dirname, 'transcode-hevc-mp4.mjs');
const qcScript = path.join(import.meta.dirname, 'make-qc-contact-sheet.mjs');
function invoke(args, success = true) {
  try {
    const result = execFileSync(process.execPath, [script, ...args], { encoding: 'utf8', timeout: 90000, maxBuffer: 8 * 1024 * 1024, stdio: ['ignore', 'pipe', 'pipe'] });
    if (!success) throw new Error('Expected encode to fail, but it succeeded: '+result.slice(-1200));
    return JSON.parse(result.trim().split('\n').at(-1));
  } catch (error) {
    if (success) throw new Error(String(error.stderr ?? error.message));
    if (error.stderr == null) throw error;
    return String(error.stderr);
  }
}
function pgsPacket(type, data, pts) {
  const header = Buffer.alloc(13); header.write('PG'); header.writeUInt32BE(pts, 2); header.writeUInt32BE(pts, 6); header[10] = type; header.writeUInt16BE(data.length, 11);
  return Buffer.concat([header, data]);
}
function bitmapFixture() {
  // A visible white rectangle, not language evidence. It ends before the video.
  const pcs = Buffer.from([1,64,0,180,16,0,0,128,0,0,1,0,0,0,0,0,140,0,140]);
  const wds = Buffer.from([1,0,0,0,0,0,1,64,0,180]);
  const palette = Buffer.from([0,0,1,235,128,128,255]);
  const rle = Buffer.from(Array.from({length:12},()=>[0,148,1,0,0]).flat());
  const object = Buffer.alloc(11); object.writeUInt16BE(0); object[3]=192; object.writeUIntBE(rle.length+4,4,3); object.writeUInt16BE(20,7);object.writeUInt16BE(12,9);
  const clear = Buffer.from([1,64,0,180,16,0,1,0,0,0,0]);
  return Buffer.concat([pgsPacket(22,pcs,22500),pgsPacket(23,wds,22500),pgsPacket(20,palette,22500),pgsPacket(21,Buffer.concat([object,rle]),22500),pgsPacket(128,Buffer.alloc(0),22500),pgsPacket(22,clear,135000),pgsPacket(128,Buffer.alloc(0),135000)]);
}

test('real FFmpeg compatibility matrix', { skip: !enabled, timeout: 240000 }, async t => {
  const tools = resolveMediaTools();
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "wwp-integration-中文 John's !-"));
  t.after(()=>fs.rmSync(dir,{recursive:true,force:true}));
  const source = path.join(dir,'source 中文 !.mkv');
  capture(tools.ffmpeg,['-v','error','-f','lavfi','-i','testsrc2=size=320x180:rate=24:duration=3','-f','lavfi','-i','sine=frequency=440:sample_rate=48000:duration=3','-c:v','libx264','-c:a','aac',source]);
  const sub=path.join(dir,"John's 中文 [test], subtitle.srt");
  fs.writeFileSync(sub,'1\n00:00:00,250 --> 00:00:02,500\n中文字幕测试 Chinese subtitle\n');
  const base=['--input',source,'--subtitle-stream','none','--duration','2'];
  const probe=file=>JSON.parse(capture(tools.ffprobe,['-v','error','-show_format','-show_streams','-of','json',file]));
  await t.test('auto SDR and special-path Chinese subtitles',()=>{
    const out=path.join(dir,'auto.mp4');
    const result=invoke([...base,'--output',out,'--subtitle-file',sub]);
    assert.equal(result.videoEncoder,process.platform==='darwin'?'hevc_videotoolbox':result.videoEncoder);
    const media=probe(out);assert.equal(media.streams[0].codec_tag_string,'hvc1');assert.equal(media.streams[0].pix_fmt,'yuv420p');
    assert.ok(Math.abs(Number(media.format.duration)-2)<0.15);
    capture(tools.ffmpeg,['-v','error','-i',out,'-xerror','-f','null','-']);
    assert.doesNotMatch(fs.readFileSync(path.join(result.jobDir,'ffmpeg.log'),'utf8'),/failed to find any fallback with glyph/u);
    assert.match(invoke([...base,'--output',out],false),/Output already exists/u);
    execFileSync(process.execPath,[qcScript,'--input',out,'--output-dir',path.join(dir,'qc'),'--columns','2','--rows','2'],{timeout:60000});
    assert.equal(JSON.parse(fs.readFileSync(path.join(dir,'qc/qc.json'))).state,'qc_ready');
  });
  await t.test('source metadata is probed once while output is independently verified',()=>{
    const wrapper=path.join(dir,'ffprobe-wrapper'), calls=path.join(dir,'probe-calls.jsonl');
    fs.writeFileSync(wrapper, `#!${process.execPath}\nconst fs=require('node:fs');const {spawnSync}=require('node:child_process');const args=process.argv.slice(2);fs.appendFileSync(${JSON.stringify(calls)},JSON.stringify(args)+'\\n');const result=spawnSync(${JSON.stringify(tools.ffprobe)},args,{stdio:'inherit'});process.exit(result.status??1);\n`);
    fs.chmodSync(wrapper,0o755);
    invoke([...base,'--output',path.join(dir,'probe-cache.mp4'),'--ffprobe',wrapper,'--subtitle-file',sub]);
    const args=fs.readFileSync(calls,'utf8').trim().split('\n').map(line=>JSON.parse(line));
    assert.equal(args.filter(row=>row.includes(source)).length,1);
    assert.ok(args.some(row=>row.some(arg=>arg.endsWith('delivery.part.mp4'))));
  });
  await t.test('CPU fallback, explicit bitrate and split audio',()=>{
    const out=path.join(dir,'cpu.mp4');const result=invoke([...base,'--output',out,'--video-encoder','libx265','--video-bitrate','800k','--split-audio']);
    assert.equal(result.videoEncoder,'libx265');assert.equal(probe(out).streams.find(s=>s.codec_type==='audio').codec_name,'aac');
  });
  await t.test('remux failure resumes verified video without re-encoding',()=>{
    const wrapper=path.join(dir,'ffmpeg-wrapper'), flag=path.join(dir,'fail-remux');
    fs.writeFileSync(flag,'fail');
    fs.writeFileSync(wrapper, `#!${process.execPath}\nconst fs=require('node:fs');const {spawnSync}=require('node:child_process');const args=process.argv.slice(2);if(args.includes('-movflags') && fs.existsSync(${JSON.stringify(flag)})){process.stderr.write('injected remux failure');process.exit(91);}const result=spawnSync(${JSON.stringify(tools.ffmpeg)},args,{stdio:'inherit'});process.exit(result.status??1);\n`);
    fs.chmodSync(wrapper,0o755);
    const out=path.join(dir,'resume.mp4');
    const args=[...base,'--output',out,'--ffmpeg',wrapper,'--ffprobe',tools.ffprobe];
    assert.match(invoke(args,false),/injected remux failure/u);
    assert.equal(fs.existsSync(out),false);assert.equal(fs.existsSync(out+'.wwp-lock'),false);
    fs.unlinkSync(flag);
    const result=invoke([...args,'--resume']);
    const log=fs.readFileSync(path.join(result.jobDir,'ffmpeg.log'),'utf8');
    assert.equal((log.match(/\nencode-mkv:/gu)??[]).length,1);
    assert.match(log,/checkpoint-decode-check/u);
    assert.equal(JSON.parse(fs.readFileSync(path.join(result.jobDir,'state.json'),'utf8')).stage,'published');
  });
  await t.test('embedded ASS keeps styles and attached font',()=>{
    const ass=path.join(dir,'styled.ass');
    fs.writeFileSync(ass,'[Script Info]\nScriptType: v4.00+\nPlayResX: 320\nPlayResY: 180\n[V4+ Styles]\nFormat: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding\nStyle: Default,Microsoft YaHei,18,&H0000FFFF,&H000000FF,&H00000000,&H00000000,0,0,0,0,100,100,0,0,1,1,0,2,10,10,10,1\n[Events]\nFormat: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text\nDialogue: 0,0:00:00.25,0:00:02.50,Default,,0,0,0,,中文样式测试\n');
    const embedded=path.join(dir,'embedded.mkv');
    const font='/System/Library/Fonts/STHeiti Medium.ttc';
    capture(tools.ffmpeg,['-v','error','-i',source,'-i',ass,'-map','0','-map','1:s:0','-c','copy',...(fs.existsSync(font)?['-attach',font,'-metadata:s:t:0','mimetype=application/x-truetype-font']:[]),embedded]);
    const result=invoke(['--input',embedded,'--output',path.join(dir,'ass.mp4'),'--subtitle-stream','0','--duration','2']);
    assert.match(fs.readFileSync(path.join(result.jobDir,'burn.ass'),'utf8'),/0000FFFF/u);
    if(fs.existsSync(font))assert.ok(fs.existsSync(path.join(result.jobDir,'fonts/attachment-3.ttc')));
  });
  await t.test('HDR10 CPU mapping uses BT.709 and never invokes CUDA on Mac',()=>{
    const hdr=path.join(dir,'hdr.mkv');
    capture(tools.ffmpeg,['-v','error','-i',source,'-c:v','libx265','-pix_fmt','yuv420p10le','-x265-params','colorprim=9:transfer=16:colormatrix=9','-c:a','copy',hdr]);
    const out=path.join(dir,'hdr.mp4');
    const result=invoke(['--input',hdr,'--output',out,'--subtitle-stream','none','--duration','2','--tone-map-sdr','--scale','320x180']);
    const v=probe(out).streams.find(s=>s.codec_type==='video');for(const key of ['color_space','color_transfer','color_primaries'])assert.equal(v[key],'bt709');
    assert.equal(v.color_range,'tv');assert.equal(result.colorPipeline.dither,'ordered');
    if(process.platform==='darwin')assert.equal(result.cpuToneMap,true);
    assert.match(invoke(['--input',hdr,'--output',path.join(dir,'unsafe-hdr.mp4'),'--subtitle-stream','none','--duration','1'],false),/HDR\/Dolby Vision source requires/u);
  });
  await t.test('CPU HDR output has explicit colorimetry and correctly padded black bars',()=>{
    const hdr=path.join(dir,'hdr-wide.mkv');
    capture(tools.ffmpeg,['-v','error','-i',source,'-vf','crop=320:136','-c:v','libx265','-pix_fmt','yuv420p10le','-x265-params','colorprim=9:transfer=16:colormatrix=9','-c:a','copy',hdr]);
    const out=path.join(dir,'hdr-wide-sdr.mp4');
    const result=invoke(['--input',hdr,'--output',out,'--subtitle-stream','none','--duration','2','--tone-map-sdr','--scale','320x180','--video-encoder','libx265']);
    const v=probe(out).streams.find(s=>s.codec_type==='video');
    assert.equal(v.width,320);assert.equal(v.height,180);assert.equal(v.color_range,'tv');
    for(const key of ['color_space','color_transfer','color_primaries'])assert.equal(v[key],'bt709');
    const raw=execFileSync(tools.ffmpeg,['-v','error','-ss','1','-i',out,'-frames:v','1','-pix_fmt','yuv420p','-f','rawvideo','-']);
    const top=raw.subarray(0,320*10);const mean=top.reduce((a,b)=>a+b,0)/top.length;
    assert.ok(Math.abs(mean-16)<2,`limited-range black bar mean=${mean}`);
    const log=fs.readFileSync(path.join(result.jobDir,'ffmpeg.log'),'utf8');
    assert.ok(log.indexOf('tonemap=hable')<log.indexOf('pad=320:180'));
  });
  await t.test('bitmap subtitles ending early never truncate output',()=>{
    const sup=path.join(dir,'bitmap.sup');fs.writeFileSync(sup,bitmapFixture());const embedded=path.join(dir,'pgs.mkv');
    capture(tools.ffmpeg,['-v','error','-i',source,'-i',sup,'-map','0','-map','1:s:0','-c','copy',embedded]);
    const out=path.join(dir,'pgs.mp4');invoke(['--input',embedded,'--output',out,'--subtitle-stream','0','--video-bitrate','800k']);
    assert.ok(Math.abs(Number(probe(out).format.duration)-3)<0.15);
    capture(tools.ffmpeg,['-v','error','-xerror','-i',out,'-f','null','-']);
  });
  await t.test('six-channel AAC retains its channel layout',()=>{
    const surround=path.join(dir,'surround.mkv');capture(tools.ffmpeg,['-v','error','-i',source,'-f','lavfi','-i','anullsrc=r=48000:cl=5.1','-map','0:v:0','-map','1:a:0','-t','3','-c:v','copy','-c:a','pcm_s16le',surround]);
    const out=path.join(dir,'surround.mp4');invoke(['--input',surround,'--output',out,'--subtitle-stream','none','--audio-channels','6','--duration','2']);
    const audio=probe(out).streams.find(s=>s.codec_type==='audio');assert.equal(audio.channels,6);assert.equal(audio.channel_layout,'5.1');
  });
  await t.test('GBK subtitle text is converted by its declared encoding',()=>{
    const gbk=path.join(dir,'gbk.srt');fs.writeFileSync(gbk,execFileSync('iconv',['-f','UTF-8','-t','GBK',sub]));
    invoke([...base,'--output',path.join(dir,'gbk.mp4'),'--subtitle-file',gbk,'--subtitle-charenc','GBK']);
  });
  await t.test('missing codec/filter errors precede any job artifacts',()=>{
    assert.match(invoke([...base,'--output',path.join(dir,'nvenc.mp4'),'--video-encoder','hevc_nvenc'],false),/No working HEVC encoder/u);
    if(process.platform==='darwin')assert.match(invoke([...base,'--output',path.join(dir,'lite.mp4'),'--subtitle-file',sub,'--ffmpeg','/opt/homebrew/bin/ffmpeg'],false),/lacks libass/u);
  });
});

test('QC samples cover the film at bounded evenly spaced timestamps',()=>{
  assert.deepEqual(sampleTimes(100,4),[12.5,37.5,62.5,87.5]);
});
