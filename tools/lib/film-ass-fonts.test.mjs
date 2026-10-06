import assert from 'node:assert/strict';
import test from 'node:test';
import { repairAssFonts } from './film-ass-fonts.mjs';

test('ASS CJK fallback preserves style attributes and dialogue overrides',()=>{
  const input='[V4+ Styles]\nFormat: Name, Fontname, Fontsize, PrimaryColour\nStyle: CJK,Microsoft YaHei,22,&H00FFFFFF\nStyle: Latin,Arial,16,&H0000FFFF\n[Events]\nDialogue: 0,0:00:01.00,0:00:02.00,CJK,,0,0,0,,{\\pos(100,200)\\fnMissingFont}中文字幕\nDialogue: 0,0:00:01.00,0:00:02.00,Latin,,0,0,0,,English';
  const result=repairAssFonts(input,new Set());
  assert.match(result.text,/Style: CJK,STHeiti,22,&H00FFFFFF/u);
  assert.match(result.text,/Style: Latin,Arial,16,&H0000FFFF/u);
  assert.match(result.text,/\\pos\(100,200\)\\fnSTHeiti/u);
  assert.equal(result.substitutions.length,2);
});

test('ASS known staged CJK fonts are retained',()=>{
  const input='[V4+ Styles]\nFormat: Name, Fontname\nStyle: Default,KnownFont\n[Events]\nDialogue: 0,0:00:01.00,0:00:02.00,Default,,0,0,0,,中文';
  const result=repairAssFonts(input,new Set(['KnownFont']));
  assert.equal(result.text,input);assert.equal(result.substitutions.length,0);
});
