function UploadSpeedCalc() {
  let startTime: number = 0;
  let totalBytes: number = 0;
  let lastUpdateTime: number = 0;
  let history: { time: number, bytes: number }[] = [];

  function start() {
    startTime = performance.now();
    lastUpdateTime = startTime;
    totalBytes = 0;
    history = [];
  }

  function update(bytesUploaded: number) {
    const now = performance.now();
    totalBytes += bytesUploaded;
    history.push({
      time: now,
      bytes: bytesUploaded
    });
    lastUpdateTime = now;
  }

  /**
   * 计算整体平均速率
   */
  function getAverageSpeed(): string {
    const elapsedSeconds = (lastUpdateTime - startTime) / 1000;
    if (elapsedSeconds <= 0) return '0 B/s';

    const averageSpeed = totalBytes / elapsedSeconds;
    return `${formatSpeed(averageSpeed)}/s`;
  }

  /**
   * 计算最近一段时间内的平均速率（滑动窗口）
   * @param windowSeconds
   */
  function getRecentAverageSpeed(windowSeconds: number): string {
    const now = performance.now();
    const cutoff = now - windowSeconds * 1000;

    // 过滤出最近windowSeconds秒内的数据
    const recentData = history.filter(entry => entry.time >= cutoff);
    if (recentData.length === 0) return "0 B/s";

    const totalBytes = recentData.reduce((sum, entry) => sum + entry.bytes, 0);
    const timeSpan = (now - recentData[0].time) / 1000;
    const averageSpeed = totalBytes / Math.max(timeSpan, 0.1);

    return `${formatSpeed(averageSpeed)}/s`;
  }

  function formatSpeed(bytesPerSecond: number): string {
    const units = ['B', 'KB', 'MB', 'GB'];
    let unitIndex = 0;

    while (bytesPerSecond >= 1024 && unitIndex < units.length - 1) {
      bytesPerSecond /= 1024;
      unitIndex++;
    }

    return `${bytesPerSecond.toFixed(2)} ${units[unitIndex]}`;
  }

  return {
    start,
    update,
    getAverageSpeed,
    getRecentAverageSpeed,
    formatSpeed,
  }
}

export { UploadSpeedCalc }
