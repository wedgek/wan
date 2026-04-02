import dayjs from 'dayjs';

/**
 * 格式化日期
 */
export const formatDate = (date, formatStr = 'YYYY-MM-DD') => 
  dayjs(date).format(formatStr);

/**
 * 格式化日期时间
 */
export const formatDateTime = (date) => 
  dayjs(date).format('YYYY-MM-DD HH:mm:ss');

/**
 * 解析日期字符串
 */
export const parseDate = (str) => {
  return dayjs(str).toDate()  
}

/**
 * 日期是否相同或在之前
 */
export const isSameOrBefore = (date1, date2, unit = 'second') => {
  const d1 = dayjs(date1);
  const d2 = dayjs(date2);
  return d1.isSame(d2, unit) || d1.isBefore(d2, unit);
};

/**
 * 日期是否相同或在之后
 */
export const isSameOrAfter = (date1, date2, unit = 'second') => {
  const d1 = dayjs(date1);
  const d2 = dayjs(date2);
  return d1.isSame(d2, unit) || d1.isAfter(d2, unit);
};

/**
 * 添加天数
 */
export const addDays = (date, days) => 
  dayjs(date).add(days, 'day').toDate();

/**
 * 减去天数
 */
export const subtractDays = (date, days) => 
  dayjs(date).subtract(days, 'day').toDate();

/**
 * 获取时间差（天数）
 */
export const diffInDays = (date1, date2) => 
  dayjs(date1).diff(dayjs(date2), 'day');

/**
 * 获取月份第一天
 */
export const getFirstDayOfMonth = (date) => 
  dayjs(date).startOf('month').toDate();

/**
 * 获取月份最后一天
 */
export const getLastDayOfMonth = (date) => 
  dayjs(date).endOf('month').toDate();

/**
 * 获取今天日期字符串
 */
export const getTodayStr = () => dayjs().format('YYYY-MM-DD');

/**
 * 拼接当天日期 + HH:mm:ss
 */
export const toTodayDateTime = (timeStr) => `${getTodayStr()} ${timeStr}`;