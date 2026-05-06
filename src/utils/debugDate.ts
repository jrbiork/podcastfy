let _offsetDays = 0;

export function getDebugDateOffset(): number {
  return _offsetDays;
}

export function setDebugDateOffset(days: number): void {
  _offsetDays = days;
}

export function getDebugDate(): Date {
  const d = new Date();
  if (_offsetDays !== 0) d.setDate(d.getDate() + _offsetDays);
  return d;
}

export function getDebugTodayUtc(): string {
  return getDebugDate().toISOString().slice(0, 10);
}
