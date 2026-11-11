const time = () => new Date().toLocaleTimeString('es-MX', { hour12: false });

export const log = {
  info: (...args) => console.log(`[${time()}]`, ...args),
  warn: (...args) => console.warn(`[${time()}] ⚠️`, ...args),
  error: (...args) => console.error(`[${time()}] ❌`, ...args),
  event: (...args) => console.log(`[${time()}] 📥`, ...args),
  action: (...args) => console.log(`[${time()}] 🎮`, ...args)
};
