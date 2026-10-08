/* 云同步日记本 · 同步核心（纯函数，可被 Node 单独测试）
 *
 * 每一天有三个时间戳：
 *   lt   本机这一天最后一次修改时间
 *   rt   服务器（GitHub）上这一天的最后修改时间
 *   base 上一次成功同步时，两边一致的那个时间
 *
 * 由此判断该拉、该推、还是两边都改了（冲突）。
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.SyncCore = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  /** 决定某一天该怎么同步。返回 'pull' | 'push' | 'conflict' | 'none' */
  function decide(lt, rt, base) {
    lt = lt || 0; rt = rt || 0; base = base || 0;
    var localChanged  = lt > base;
    var remoteChanged = rt > base;
    if (localChanged && remoteChanged) return lt === rt ? 'none' : 'conflict';
    if (remoteChanged) return 'pull';
    if (localChanged)  return 'push';
    return 'none';
  }

  /* 本地版用的判断。本地那边的「时间」是文件修改时间，云端那边是 index.json 里记的时间，
   * 两个数不是一套钟，不能直接比。所以各存各的同步点：
   *   lt / baseL  本地文件修改时间 / 上次同步时它是多少
   *   rt / baseR  云端记录的时间   / 上次同步时它是多少
   */
  function decideSplit(lt, baseL, rt, baseR) {
    var localChanged  = (lt || 0) > (baseL || 0);
    var remoteChanged = (rt || 0) > (baseR || 0);
    if (localChanged && remoteChanged) return 'conflict';
    if (remoteChanged) return 'pull';
    if (localChanged)  return 'push';
    return 'none';
  }

  /** 冲突时把两边的内容都保留下来，绝不丢字 */
  function mergeText(localText, remoteText) {
    localText  = localText  || '';
    remoteText = remoteText || '';
    if (localText === remoteText) return localText;
    if (!localText)  return remoteText;
    if (!remoteText) return localText;
    // 一边完整包含另一边（常见于「一台设备继续往下写」），取长的那份
    if (localText.indexOf(remoteText) === 0)  return localText;
    if (remoteText.indexOf(localText) === 0)  return remoteText;
    return localText + '\n\n———— 另一台设备上写的 ————\n\n' + remoteText;
  }

  /** 'YYYY-MM-DD' -> 'YYYY/YYYY-MM-DD.txt'（一年一个文件夹） */
  function pathOf(dateKey) { return dateKey.slice(0, 4) + '/' + dateKey + '.txt'; }

  /* ---- 图片 ----
   * 图片文件名一旦生成就不再改动，所以不存在「同一张图两边内容不一样」的冲突。
   * 要处理的只有「这一天有哪几张图」这个清单：两边取并集，再去掉任何一边删过的。
   * gone 是墓碑，记住删掉的名字，免得另一台设备的旧清单把它又拉回来。
   */
  function imgPath(dateKey, name) { return dateKey.slice(0, 4) + '/img/' + name; }

  function newImgName(dateKey) {
    return dateKey + '-' + Date.now().toString(36)
         + Math.random().toString(36).slice(2, 6) + '.jpg';
  }

  function mergeImgs(localImgs, localGone, remoteImgs, remoteGone) {
    var gone = {};
    (localGone || []).concat(remoteGone || []).forEach(function (n) { gone[n] = 1; });
    var seen = {}, imgs = [];
    (localImgs || []).concat(remoteImgs || []).forEach(function (n) {
      if (!gone[n] && !seen[n]) { seen[n] = 1; imgs.push(n); }
    });
    imgs.sort();                       // 文件名带时间戳，排序即按拍摄先后
    return { imgs: imgs, gone: Object.keys(gone).sort() };
  }

  function isDateKey(s) { return /^\d{4}-\d{2}-\d{2}$/.test(s); }

  /* ---- UTF-8 <-> base64（GitHub API 收发的是 base64） ---- */
  function b64encode(str) {
    var bytes = new TextEncoder().encode(str), bin = '';
    for (var i = 0; i < bytes.length; i += 0x8000)
      bin += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000));
    return btoa(bin);
  }
  function b64decode(b64) {
    var bin = atob(String(b64).replace(/\s/g, ''));
    var bytes = new Uint8Array(bin.length);
    for (var i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
    return new TextDecoder().decode(bytes);
  }

  /* 合并两份 index.json（「哪天有日记」的总目录）。
   * 两边的日子全都保留——目录里少一天，别的设备就看不到那天的日记了，所以只增不减。
   * 同一天取较新的时间；照片清单按并集 + 墓碑合。
   */
  function mergeIndex(theirs, mine) {
    theirs = theirs || {}; mine = mine || {};
    var out = {}, d;
    for (d in theirs) out[d] = theirs[d];
    for (d in mine) {
      var a = theirs[d] || {}, b = mine[d] || {};
      var im = mergeImgs(b.imgs, b.gone, a.imgs, a.gone);
      var e = { t: Math.max(a.t || 0, b.t || 0) };
      if (im.imgs.length) e.imgs = im.imgs;
      if (im.gone.length) e.gone = im.gone;
      out[d] = e;
    }
    return out;
  }

  /* ---- 日历：生成某年某月的整月格子 ----
   * year 四位数，month 是 1~12。返回若干「周」，每周 7 格（周日起头）。
   * 有日期的格子是 'YYYY-MM-DD'，补位的空格子是 null。
   */
  function monthGrid(year, month) {
    var first = new Date(year, month - 1, 1);
    var daysInMonth = new Date(year, month, 0).getDate();
    var lead = first.getDay();                       // 这个月 1 号是星期几
    var cells = [];
    for (var i = 0; i < lead; i++) cells.push(null);
    for (var d = 1; d <= daysInMonth; d++)
      cells.push(year + '-' + String(month).padStart(2, '0') + '-' + String(d).padStart(2, '0'));
    while (cells.length % 7 !== 0) cells.push(null);
    var weeks = [];
    for (var j = 0; j < cells.length; j += 7) weeks.push(cells.slice(j, j + 7));
    return weeks;
  }

  /** 月份加减，返回 {y, m}。m 用 1~12，跨年自动进位 */
  function shiftMonth(year, month, delta) {
    var n = (year * 12 + (month - 1)) + delta;
    return { y: Math.floor(n / 12), m: (n % 12) + 1 };
  }

  return { decide: decide, decideSplit: decideSplit, mergeText: mergeText, pathOf: pathOf,
           isDateKey: isDateKey, b64encode: b64encode, b64decode: b64decode,
           monthGrid: monthGrid, shiftMonth: shiftMonth,
           imgPath: imgPath, newImgName: newImgName, mergeImgs: mergeImgs,
           mergeIndex: mergeIndex };
});
