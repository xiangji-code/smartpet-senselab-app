const BEIJING_TIME_ZONE = 'Asia/Shanghai';

interface BeijingDateTimeOptions {
  includeYear?: boolean;
}

export function formatBeijingDateTime(
  iso: string,
  options: BeijingDateTimeOptions = {},
): string {
  const date = new Date(normalizeBackendDateTime(iso));
  if (Number.isNaN(date.getTime())) return '时间未知';

  const formatter = new Intl.DateTimeFormat('zh-CN', {
    timeZone: BEIJING_TIME_ZONE,
    year: options.includeYear ? 'numeric' : undefined,
    month: 'numeric',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  });
  const parts = Object.fromEntries(
    formatter
      .formatToParts(date)
      .filter((part) => part.type !== 'literal')
      .map((part) => [part.type, part.value]),
  );
  const datePart = options.includeYear
    ? `${parts.year}-${parts.month}-${parts.day}`
    : `${parts.month}-${parts.day}`;
  return `${datePart} ${parts.hour}:${parts.minute}`;
}

function normalizeBackendDateTime(value: string): string {
  const trimmed = value.trim();
  const isIsoDateTime = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/.test(trimmed);
  const hasExplicitTimeZone = /(?:Z|[+-]\d{2}:\d{2}|[+-]\d{4})$/i.test(trimmed);

  // 后端 datetime 字段统一表达 UTC；部分数据库响应会省略末尾的 Z。
  return isIsoDateTime && !hasExplicitTimeZone ? `${trimmed}Z` : trimmed;
}
