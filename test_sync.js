/* 同步逻辑自测： node test_sync.js  （不需要联网、不碰真实数据） */
const S = require('./sync-core.js');

let pass = 0, fail = 0;
function eq(actual, expect, name) {
  const ok = JSON.stringify(actual) === JSON.stringify(expect);
  if (ok) { pass++; }
  else { fail++; console.log(`✗ ${name}\n   得到: ${JSON.stringify(actual)}\n   应为: ${JSON.stringify(expect)}`); }
}

/* ---- decide(lt本机, rt云端, base上次同步点) ---- */
eq(S.decide(0, 0, 0),          'none',     '两边都空 → 不动');
eq(S.decide(100, 0, 0),        'push',     '第一次写日记 → 上传');
eq(S.decide(0, 100, 0),        'pull',     '新设备第一次打开 → 下载');
eq(S.decide(100, 100, 100),    'none',     '刚同步完 → 不动');
eq(S.decide(200, 100, 100),    'push',     '本机改过、云端没动 → 上传');
eq(S.decide(100, 200, 100),    'pull',     '别的设备改过 → 下载');
eq(S.decide(200, 300, 100),    'conflict', '两边都改过 → 冲突合并');
eq(S.decide(300, 300, 100),    'none',     '两边时间一样 → 视为已同步');
eq(S.decide(50, 0, 100),       'none',     '本机时间比同步点还早（异常）→ 不动');
eq(S.decide(0, 100, 200),      'none',     '云端时间比同步点还早（异常）→ 不动');
eq(S.decide(undefined, undefined, undefined), 'none', '全是 undefined → 不动');

/* ---- mergeText 绝不丢字 ---- */
eq(S.mergeText('', ''),                    '',            '两边都空');
eq(S.mergeText('今天下雨', ''),             '今天下雨',     '云端空 → 保留本机');
eq(S.mergeText('', '今天下雨'),             '今天下雨',     '本机空 → 取云端');
eq(S.mergeText('今天下雨', '今天下雨'),      '今天下雨',     '完全一样 → 不重复');
eq(S.mergeText('今天下雨了，很凉快', '今天下雨了'), '今天下雨了，很凉快', '本机是云端的续写 → 取长的');
eq(S.mergeText('今天下雨了', '今天下雨了，很凉快'), '今天下雨了，很凉快', '云端是本机的续写 → 取长的');
{
  const m = S.mergeText('电脑上写的', '手机上写的');
  eq(m.includes('电脑上写的') && m.includes('手机上写的'), true, '真冲突 → 两边内容都保留');
  eq(m.includes('另一台设备'), true, '真冲突 → 有分隔标记');
}

/* ---- 路径：一年一个文件夹 ---- */
eq(S.pathOf('2026-07-29'), '2026/2026-07-29.txt', '2026 年的日记进 2026 文件夹');
eq(S.pathOf('2027-01-01'), '2027/2027-01-01.txt', '跨年自动进新文件夹');

/* ---- 日期键校验 ---- */
eq(S.isDateKey('2026-07-29'), true,  '正常日期');
eq(S.isDateKey('2026-7-9'),   false, '没补零的不算');
eq(S.isDateKey('diaryCfg'),   false, '配置键不算');
eq(S.isDateKey(''),           false, '空字符串不算');

/* ---- base64 中日文往返 ---- */
{
  const cases = ['今天很开心 😊', 'ゆうの日記', 'a'.repeat(50000), '', '换行\n和\t制表符'];
  let ok = true;
  for (const c of cases) if (S.b64decode(S.b64encode(c)) !== c) { ok = false; console.log('  往返失败:', c.slice(0,20)); }
  eq(ok, true, 'base64 编解码往返（中日文/emoji/长文本/空/换行）');
}

/* ---- 场景串演：电脑写 → 手机同步 → 手机改 → 电脑同步 ---- */
{
  const pc = { t: 0, base: 0 }, ph = { t: 0, base: 0 };
  let cloud = { t: 0, text: '' };

  // 1. 电脑上写了日记
  pc.t = 1000;
  eq(S.decide(pc.t, cloud.t, pc.base), 'push', '场景1 电脑首次写 → 上传');
  cloud = { t: pc.t, text: '电脑写的' }; pc.base = pc.t;

  // 2. 手机第一次打开
  eq(S.decide(ph.t, cloud.t, ph.base), 'pull', '场景2 手机首次打开 → 下载');
  ph.t = cloud.t; ph.base = cloud.t;

  // 3. 手机上续写
  ph.t = 2000;
  eq(S.decide(ph.t, cloud.t, ph.base), 'push', '场景3 手机续写 → 上传');
  cloud = { t: ph.t, text: '电脑写的\n手机续的' }; ph.base = ph.t;

  // 4. 电脑再打开
  eq(S.decide(pc.t, cloud.t, pc.base), 'pull', '场景4 电脑再打开 → 收到手机内容');
  pc.t = cloud.t; pc.base = cloud.t;
  eq(S.decide(pc.t, cloud.t, pc.base), 'none', '场景5 再点同步 → 已一致，不重复传');
}

/* ---- 场景：两边离线各写各的 ---- */
{
  const base = 1000, cloudT = 3000, localT = 2500;
  eq(S.decide(localT, cloudT, base), 'conflict', '场景6 两边离线各写 → 判为冲突');
  const merged = S.mergeText('电脑离线写的', '手机离线写的');
  eq(merged.includes('电脑离线写的') && merged.includes('手机离线写的'), true, '场景6 合并后两份都在');
}

console.log(`\n通过 ${pass} 项${fail ? `，失败 ${fail} 项` : '，全部通过 ✓'}`);
process.exit(fail ? 1 : 0);
