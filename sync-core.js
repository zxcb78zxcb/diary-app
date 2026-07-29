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

  return { decide: decide, mergeText: mergeText, pathOf: pathOf,
           isDateKey: isDateKey, b64encode: b64encode, b64decode: b64decode,
           monthGrid: monthGrid, shiftMonth: shiftMonth };
});
