type LogLevel = 'info' | 'warn' | 'error' | 'debug'

export type Logger = {
  info: (message: string, meta?: Record<string, unknown>) => void
  warn: (message: string, meta?: Record<string, unknown>) => void
  error: (message: string, meta?: Record<string, unknown>) => void
  debug: (message: string, meta?: Record<string, unknown>) => void
}

const emit = (level: LogLevel, service: string, message: string, meta?: Record<string, unknown>) => {
  const entry = JSON.stringify({
    level,
    service,
    message,
    ts: new Date().toISOString(),
    ...meta,
  })
  if (level === 'error') console.error(entry)
  else if (level === 'warn') console.warn(entry)
  else console.log(entry)
}

export const createLogger = (service: string): Logger => ({
  info:  (message, meta) => emit('info',  service, message, meta),
  warn:  (message, meta) => emit('warn',  service, message, meta),
  error: (message, meta) => emit('error', service, message, meta),
  debug: (message, meta) => emit('debug', service, message, meta),
})
