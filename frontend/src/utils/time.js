
export function getTimeGreeting(userName) {
  const hour = new Date().getHours()
  if (hour < 12) return '早上好！祝你工作愉快'
  if (hour < 18) return '下午好！继续加油'
  return '晚上好！' + userName
}