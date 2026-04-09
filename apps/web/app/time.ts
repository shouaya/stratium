export const TOKYO_TIME_ZONE = "Asia/Tokyo";

const dateTimeFormatter = new Intl.DateTimeFormat("en-US", {
  timeZone: TOKYO_TIME_ZONE,
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
  second: "2-digit",
  hour12: false
});

const timeFormatter = new Intl.DateTimeFormat("en-US", {
  timeZone: TOKYO_TIME_ZONE,
  hour: "2-digit",
  minute: "2-digit",
  second: "2-digit",
  hour12: false
});

export const formatTokyoDateTime = (value?: string): string =>
  value ? dateTimeFormatter.format(new Date(value)) : "--";

export const formatTokyoTime = (value?: string): string =>
  value ? timeFormatter.format(new Date(value)) : "--:--:--";
