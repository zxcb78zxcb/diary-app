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

/* ---- 日历：月份格子 ---- */
{
  // 2026 年 7 月：1 号是星期三，31 天
  const g = S.monthGrid(2026, 7);
  eq(g.every(w => w.length === 7), true, '日历 每周 7 格');
  eq(g[0].slice(0, 3), [null, null, null], '2026-07 前面空 3 格（1号是周三）');
  eq(g[0][3], '2026-07-01', '第一格日期对上');
  eq(g.flat().filter(Boolean).length, 31, '2026-07 共 31 天');
  eq(g.flat().filter(Boolean).pop(), '2026-07-31', '最后一天是 31 号');
  eq(g.flat().length % 7, 0, '总格子数是 7 的倍数');

  // 2 月 / 闰年
  eq(S.monthGrid(2026, 2).flat().filter(Boolean).length, 28, '2026-02 是 28 天');
  eq(S.monthGrid(2028, 2).flat().filter(Boolean).length, 29, '2028 闰年 2 月 29 天');
  eq(S.monthGrid(2100, 2).flat().filter(Boolean).length, 28, '2100 不是闰年');

  // 每个月都合法
  let allOk = true;
  for (let y = 2024; y <= 2030; y++) for (let m = 1; m <= 12; m++) {
    const days = S.monthGrid(y, m).flat().filter(Boolean);
    const expect = new Date(y, m, 0).getDate();
    if (days.length !== expect) { allOk = false; console.log('  月份不对', y, m); }
    if (!days.every(S.isDateKey)) { allOk = false; console.log('  日期格式不对', y, m); }
    // 星期要对得上：第一天所在列 === 它真实的星期
    const grid = S.monthGrid(y, m);
    if (grid[0].indexOf(days[0]) !== new Date(y, m - 1, 1).getDay()) { allOk = false; console.log('  星期错位', y, m); }
  }
  eq(allOk, true, '2024–2030 每个月天数、格式、星期位置全对');
}

/* ---- 日历：翻月 ---- */
eq(S.shiftMonth(2026, 7, 1),   {y:2026, m:8},  '7月 → 8月');
eq(S.shiftMonth(2026, 7, -1),  {y:2026, m:6},  '7月 → 6月');
eq(S.shiftMonth(2026, 12, 1),  {y:2027, m:1},  '12月往后跨年');
eq(S.shiftMonth(2026, 1, -1),  {y:2025, m:12}, '1月往前跨年');
eq(S.shiftMonth(2026, 7, 12),  {y:2027, m:7},  '往后 12 个月 = 明年同月');
eq(S.shiftMonth(2026, 7, -12), {y:2025, m:7},  '往前 12 个月 = 去年同月');
eq(S.shiftMonth(2026, 1, -13), {y:2024, m:12}, '往前跨两年');
{
  // 连翻 60 个月，结果必须始终合法
  let y = 2026, m = 7, ok = true;
  for (let i = 0; i < 60; i++) {
    const n = S.shiftMonth(y, m, 1); y = n.y; m = n.m;
    if (m < 1 || m > 12 || !Number.isInteger(y)) { ok = false; break; }
  }
  eq(ok && y === 2031 && m === 7, true, '连翻 60 个月 → 2031年7月，月份始终 1~12');
}

console.log(`\n通过 ${pass} 项${fail ? `，失败 ${fail} 项` : '，全部通过 ✓'}`);
process.exit(fail ? 1 : 0);
